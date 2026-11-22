import { readGeminiAttendees } from './gemini-attendees.ts';
import { MeetingInputError, type MeetingInput, type TranscriptTurn } from './meeting-input.ts';
import { sectionProse } from './section-prose.ts';
import { rfc3339Instant, wallClockIn, type WallTime } from './wall-clock.ts';

/*
 * A Granola note — `GET /v1/notes/{id}?include=transcript` of Granola's
 * public API — as a meeting note's input, with DFAI's mapping rules
 * (`granolaNoteToFields`). Pure: the zone the times are written in is passed
 * in, never read from the Mac.
 */

export interface GranolaMappingOptions {
  /** The IANA zone whose clock the meeting's times are written on. */
  readonly timeZone: string;
  /**
   * The person's own addresses. Granola's `me` is the note's owner, who is
   * `You` only when the owner is this person: a note shared by someone else
   * names them instead. None: every `me` is the owner's name.
   */
  readonly selfEmails: readonly string[];
}

type JsonRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function optionalRecord(value: unknown, field: string): JsonRecord | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new MeetingInputError(`${field}: expected an object or null`);
  return value;
}

function listOf(value: unknown, field: string): readonly unknown[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new MeetingInputError(`${field}: expected a list`);
  return value;
}

function recordAt(value: unknown, field: string): JsonRecord {
  if (!isRecord(value)) throw new MeetingInputError(`${field}: expected an object`);
  return value;
}

/** Text on one line, or '' for nothing; anything but text is refused by name. */
function oneLine(value: unknown, field: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new MeetingInputError(`${field}: expected text`);
  return value.replace(/\s+/g, ' ').trim();
}

function multiline(value: unknown, field: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new MeetingInputError(`${field}: expected text`);
  return value;
}

/** The first of the fields with text in it (Granola's markdown, else its plain text). */
function firstWithText(fields: readonly (readonly [field: string, value: unknown])[]): string {
  for (const [field, value] of fields) {
    const text = multiline(value, field);
    if (text.trim() !== '') return text;
  }
  return '';
}

const instantOf = (value: unknown): number | null =>
  typeof value === 'string' ? rfc3339Instant(value) : null;

const addressKey = (email: string) => email.trim().toLowerCase();

/** Who Granola's `me` is: `You` when the owner is the person, else the owner's name, else Unknown. */
function noteTakerOf(note: JsonRecord, selfEmails: readonly string[]): string {
  const owner = optionalRecord(note.owner, 'owner');
  const email = addressKey(oneLine(owner?.email, 'owner.email'));
  if (email !== '' && selfEmails.some((each) => addressKey(each) === email)) return 'You';
  return oneLine(owner?.name, 'owner.name') || 'Unknown';
}

/**
 * Who spoke: the name Granola resolved, else the note's owner for `me`, else
 * Unknown. A `*` cannot stand in a speaker written `**Name**`.
 */
function speakerOf(value: unknown, field: string, noteTaker: string): string {
  const speaker = optionalRecord(value, field);
  const name = oneLine(speaker?.name, `${field}.name`)
    .replace(/\*+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name !== '') return name;
  return speaker?.attribution === 'me' ? noteTaker : 'Unknown';
}

/** One transcript item read, with the span it covers for the meeting's own start and end. */
interface ReadItem {
  readonly turn: TranscriptTurn;
  readonly began: number | null;
  readonly ended: number | null;
}

function readItem(
  value: unknown,
  at: number,
  reading: { clock: (instant: number) => WallTime; noteTaker: string },
): ReadItem {
  const item = recordAt(value, `transcript[${at}]`);
  const began = instantOf(item.start_time);
  const ended = instantOf(item.end_time);
  const time = began === null ? null : reading.clock(began).time;
  return {
    turn: {
      speaker: speakerOf(item.speaker, `transcript[${at}].speaker`, reading.noteTaker),
      ...(time === null ? {} : { time }),
      text: oneLine(item.text, `transcript[${at}].text`),
    },
    began,
    // A turn that ends before it starts ends, for the meeting, when it starts.
    ended: extreme(Math.max, [began, ended]),
  };
}

/** The earliest or latest of the times known, taken pairwise; null when none is. */
function extreme(pick: (a: number, b: number) => number, times: readonly (number | null)[]) {
  let found: number | null = null;
  for (const time of times) {
    if (time !== null) found = found === null ? time : pick(found, time);
  }
  return found;
}

/**
 * When the meeting began and ended: the calendar event's scheduled times,
 * else its first turn's start and last turn's end. With no start at all it
 * is refused, rather than given a made-up day. An end before the start is no end.
 */
function spanOf(event: JsonRecord | null, items: readonly ReadItem[]) {
  const start =
    instantOf(event?.scheduled_start_time) ??
    extreme(
      Math.min,
      items.map((item) => item.began),
    );
  if (start === null) {
    throw new MeetingInputError(
      'start: the Granola note has no start: no calendar event time, and no transcript turn with a time',
    );
  }
  const end =
    instantOf(event?.scheduled_end_time) ??
    extreme(
      Math.max,
      items.map((item) => item.ended),
    );
  return { start, end: end !== null && end < start ? null : end };
}

/**
 * The end as the When line writes it: `HH:MM` on the start's day, with its
 * date when it is a later day's, and none when the clock shows it before the
 * start (a fall-back hour).
 */
function endOnClock(began: WallTime, ended: WallTime): string | null {
  const time = ended.time.slice(0, 5);
  if (ended.day !== began.day) return `${ended.day} ${time}`;
  return time < began.time.slice(0, 5) ? null : time;
}

/** Who was there: the attendees, then the calendar's invitees, one per address, mailing lists left out. */
function attendeesOf(note: JsonRecord, event: JsonRecord | null) {
  const attendees = listOf(note.attendees, 'attendees').map((each, at) => {
    const person = recordAt(each, `attendees[${at}]`);
    return {
      name: oneLine(person.name, `attendees[${at}].name`),
      email: oneLine(person.email, `attendees[${at}].email`),
    };
  });
  const invitees = listOf(event?.invitees, 'calendar_event.invitees').map((each, at) => ({
    email: oneLine(
      recordAt(each, `calendar_event.invitees[${at}]`).email,
      `calendar_event.invitees[${at}].email`,
    ),
  }));
  // The same reading of records as Gemini's attendees: by address, a display name winning.
  return readGeminiAttendees([...attendees, ...invitees]);
}

function titleOf(note: JsonRecord, event: JsonRecord | null): string {
  const title =
    oneLine(note.title, 'title') || oneLine(event?.event_title, 'calendar_event.event_title');
  if (title === '')
    throw new MeetingInputError('title: missing (no title, and no calendar event title)');
  return title;
}

/**
 * A Granola note as a meeting note's input, its times on the clock of
 * `timeZone`. The title is the note's, else its calendar event's; the
 * attendees and invitees are merged by address; the summary is Granola's AI
 * notes (markdown, else plain text), the owner's own notes are Notes, both
 * with their headings kept inside the section; each turn is named and
 * stamped with its time of day, a turn with no words dropped; the source is
 * the note in Granola's web app.
 */
export function fromGranola(value: unknown, options: GranolaMappingOptions): MeetingInput {
  if (!isRecord(value)) throw new MeetingInputError('the Granola note: expected an object');
  const note = value;
  const clock = wallClockIn(options.timeZone);
  const event = optionalRecord(note.calendar_event, 'calendar_event');
  const reading = { clock, noteTaker: noteTakerOf(note, options.selfEmails) };
  const items = listOf(note.transcript, 'transcript')
    .map((each, at) => readItem(each, at, reading))
    .filter((item) => item.turn.text !== '');
  const { start, end } = spanOf(event, items);
  const began = clock(start);
  const ends = end === null ? null : endOnClock(began, clock(end));
  const summary = sectionProse(
    firstWithText([
      ['summary_markdown', note.summary_markdown],
      ['summary_text', note.summary_text],
    ]),
  );
  const notes = sectionProse(
    firstWithText([
      ['private_notes_markdown', note.private_notes_markdown],
      ['private_notes_text', note.private_notes_text],
    ]),
  );
  const url = oneLine(note.web_url, 'web_url');
  return {
    title: titleOf(note, event),
    date: began.day,
    start: began.time.slice(0, 5),
    ...(ends === null ? {} : { end: ends }),
    attendees: attendeesOf(note, event),
    ...(summary === '' ? {} : { summary }),
    ...(notes === '' ? {} : { notes }),
    transcript: items.map((item) => item.turn),
    ...(url === '' ? {} : { sourceUrl: url }),
  };
}
