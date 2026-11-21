/** Someone at the meeting. With no name, the note names them by their address's local part. */
export interface MeetingAttendee {
  readonly name: string;
  readonly email?: string;
}

/** One turn of a transcript: who spoke, when (`hh:mm:ss`, as the provider counts it), and what. */
export interface TranscriptTurn {
  readonly speaker: string;
  readonly time?: string;
  readonly text: string;
}

/** Everything a meeting note is written from. Only `title`, `date` and `attendees` are required. */
export interface MeetingInput {
  readonly title: string;
  /** `YYYY-MM-DD`: the day the meeting was held. */
  readonly date: string;
  /** `HH:MM`, as written: no zone is read or converted. */
  readonly start?: string;
  readonly end?: string;
  readonly attendees: readonly MeetingAttendee[];
  /** Notes the meeting was about, by name: each becomes a `[[link]]`. */
  readonly about?: readonly string[];
  readonly summary?: string;
  readonly decisions?: readonly string[];
  readonly nextSteps?: readonly string[];
  /** Free notes (a provider's "Details"), markdown. */
  readonly notes?: string;
  readonly transcript?: readonly TranscriptTurn[];
  /** The meeting in the provider's own app. Written only when it is an `http(s)` address. */
  readonly sourceUrl?: string;
}

/** A meeting input that cannot become a note: what is wrong, by field. */
export class MeetingInputError extends Error {
  override readonly name = 'MeetingInputError';
}

type Fields = Record<string, unknown>;

/** `value` as text; `label` names the field in an error. */
function text(value: unknown, label: string, required: boolean): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new MeetingInputError(`${label}: missing`);
    return undefined;
  }
  if (typeof value !== 'string') throw new MeetingInputError(`${label}: expected text`);
  return value;
}

function list<T>(fields: Fields, key: string, read: (item: unknown, at: string) => T): T[] {
  const value = fields[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new MeetingInputError(`${key}: expected a list`);
  return value.map((item, at) => read(item, `${key}[${at}]`));
}

function record(item: unknown, at: string): Fields {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    throw new MeetingInputError(`${at}: expected an object`);
  }
  return item as Fields;
}

function line(item: unknown, at: string): string {
  if (typeof item !== 'string') throw new MeetingInputError(`${at}: expected text`);
  return item;
}

function attendee(item: unknown, at: string): MeetingAttendee {
  const fields = record(item, at);
  const email = text(fields.email, `${at}.email`, false);
  return {
    name: text(fields.name, `${at}.name`, false) ?? '',
    ...(email === undefined ? {} : { email }),
  };
}

function turn(item: unknown, at: string): TranscriptTurn {
  const fields = record(item, at);
  const time = text(fields.time, `${at}.time`, false);
  return {
    speaker: text(fields.speaker, `${at}.speaker`, false) ?? '',
    ...(time === undefined ? {} : { time }),
    text: text(fields.text, `${at}.text`, true) ?? '',
  };
}

/** Drops the keys whose value is undefined, so optional fields stay absent rather than undefined. */
function present<T extends object>(fields: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

/** A meeting input read from untyped JSON (the CLI's file, an n8n item); refused field by field. */
export function parseMeetingInput(value: unknown): MeetingInput {
  const fields = record(value, 'input');
  return present({
    title: text(fields.title, 'title', true) ?? '',
    date: text(fields.date, 'date', true) ?? '',
    start: text(fields.start, 'start', false),
    end: text(fields.end, 'end', false),
    attendees: list(fields, 'attendees', attendee),
    about: list(fields, 'about', line),
    summary: text(fields.summary, 'summary', false),
    decisions: list(fields, 'decisions', line),
    nextSteps: list(fields, 'nextSteps', line),
    notes: text(fields.notes, 'notes', false),
    transcript: list(fields, 'transcript', turn),
    sourceUrl: text(fields.sourceUrl, 'sourceUrl', false),
  });
}
