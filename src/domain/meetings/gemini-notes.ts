import { cleanNoteName } from '../vault/index.ts';
import { readGeminiAttendees } from './gemini-attendees.ts';
import { readGeminiSubject } from './gemini-stated.ts';
import { readGeminiTranscript } from './gemini-transcript.ts';
import { MeetingInputError, type MeetingInput } from './meeting-input.ts';

/**
 * A "Notes by Gemini" meeting as an n8n workflow assembles it from the email
 * and its doc (the field names DFAI's workflow already uses). Untyped: it
 * arrives as JSON.
 */
export interface GeminiNotes {
  /** The email subject or the doc title: it states the day, and the start when given. */
  readonly subject?: unknown;
  /** The meeting's title, when the workflow has it; else it is read from `subject`. */
  readonly title?: unknown;
  /** `{ name, email }` records, or `Name — email` lines. */
  readonly attendees?: unknown;
  /** The notes: `## Summary`, `## Decisions`, `## Next steps`, `## Details`. */
  readonly summaryMd?: unknown;
  readonly transcriptMd?: unknown;
  readonly url?: unknown;
}

type SectionName = 'summary' | 'decisions' | 'nextSteps' | 'notes';

/** A heading naming one of Gemini's four parts, at any level, alone on its line. */
const SECTION_HEADING =
  /^ {0,3}#{1,6}[ \t]+(summary|decisions|(?:suggested )?next steps|details)[ \t#]*$/i;
const FENCE = /^\s*(?:```|~~~)/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
/** Gemini's owner of a next step, `[Tobias Fenn] Flag the cache`: not a checkbox, not a markdown link. */
const OWNER = /^\[([^\][]*\p{L}[^\][]*)\](?![([])\s*/u;

function optionalText(value: unknown, field: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new MeetingInputError(`${field}: expected text`);
  return value;
}

function sectionOf(line: string): SectionName | null {
  const name = SECTION_HEADING.exec(line)?.[1]?.toLowerCase();
  if (name === undefined) return null;
  if (name === 'details') return 'notes';
  return name.endsWith('next steps') ? 'nextSteps' : (name as SectionName);
}

/** The notes split at Gemini's headings; text before the first is summary; a heading in code opens nothing. */
function splitSections(notes: string): Record<SectionName, string> {
  const gathered: Record<SectionName, string[]> = {
    summary: [],
    decisions: [],
    nextSteps: [],
    notes: [],
  };
  let current: SectionName = 'summary';
  let inFence = false;
  for (const line of notes.split(/\r\n?|\n/)) {
    if (FENCE.test(line)) inFence = !inFence;
    const opened = inFence ? null : sectionOf(line);
    if (opened === null) gathered[current].push(line);
    else current = opened;
  }
  const joined = (name: SectionName) => gathered[name].join('\n').trim();
  return {
    summary: joined('summary'),
    decisions: joined('decisions'),
    nextSteps: joined('nextSteps'),
    notes: joined('notes'),
  };
}

/** A section's list items, a wrapped line joined to its item; a line before any item is one. */
function items(section: string): string[] {
  const found: string[] = [];
  let open = false;
  for (const line of section.split('\n')) {
    const item = ITEM.exec(line);
    if (item !== null) found.push(item[1] ?? '');
    else if (line.trim() !== '' && open) found[found.length - 1] += ` ${line.trim()}`;
    else if (line.trim() !== '') found.push(line.trim());
    open = line.trim() !== '' && found.length > 0;
  }
  return found.map((each) => each.replace(/\s+/g, ' ').trim()).filter((each) => each !== '');
}

/** `[Tobias Fenn] Flag the cache` → `[[Tobias Fenn]] Flag the cache`. */
function linkedOwner(step: string): string {
  const owner = OWNER.exec(step);
  const name = cleanNoteName(owner?.[1] ?? '');
  if (owner === null || name === '') return step;
  return `[[${name}]] ${step.slice(owner[0].length)}`.trim();
}

/**
 * A Gemini meeting as a meeting note's input: the day, start and title from
 * the subject (or `title`), people from the attendees, the four parts of the
 * notes split at their headings (Details become Notes), each next step's
 * `[Owner]` linked, and the transcript's turns. Throws a
 * {@link MeetingInputError} when the subject states no day.
 */
export function fromGeminiNotes(value: unknown): MeetingInput {
  if (typeof value !== 'object' || value === null) {
    throw new MeetingInputError('notes: expected an object');
  }
  const fields = value as GeminiNotes;
  const stated = readGeminiSubject(optionalText(fields.subject, 'subject'));
  const title = optionalText(fields.title, 'title').trim() || stated.title;
  const sections = splitSections(optionalText(fields.summaryMd, 'summaryMd'));
  const url = optionalText(fields.url, 'url').trim();
  return {
    title,
    date: stated.date,
    ...(stated.start === null ? {} : { start: stated.start }),
    attendees: readGeminiAttendees(fields.attendees),
    ...(sections.summary === '' ? {} : { summary: sections.summary }),
    decisions: items(sections.decisions),
    nextSteps: items(sections.nextSteps).map(linkedOwner),
    ...(sections.notes === '' ? {} : { notes: sections.notes }),
    transcript: readGeminiTranscript(optionalText(fields.transcriptMd, 'transcriptMd')),
    ...(url === '' ? {} : { sourceUrl: url }),
  };
}
