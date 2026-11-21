import { cleanNoteName } from '../vault/index.ts';
import { MeetingInputError, type MeetingInput, type TranscriptTurn } from './meeting-input.ts';

/** A meeting note and where the vault contract puts it. */
export interface MeetingNote {
  readonly path: string;
  readonly text: string;
}

/** One `## Heading` section of a meeting note, as written from the input. */
export interface NoteSection {
  readonly heading: string;
  readonly body: string;
}

const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** A web address someone can open: `javascript:` and the like are never written. */
const WEB_ADDRESS = /^https?:\/\/[^\s/]\S*$/i;
/** The sections in the order the contract writes them; the transcript always last. */
export const SECTION_ORDER = ['Summary', 'Decisions', 'Next steps', 'Notes', 'Transcript'];
const FALLBACK_TITLE = 'Meeting';

function checkedDate(date: string): string {
  if (!DAY.test(date))
    throw new MeetingInputError(`date: ${JSON.stringify(date)} is not YYYY-MM-DD`);
  return date;
}

/** `Meetings/<YYYY>/<MM>/<YYYY-MM-DD> <title>.md`, the title cleaned of what a file name may not hold. */
export function meetingPath({ date, title }: Pick<MeetingInput, 'date' | 'title'>): string {
  const day = checkedDate(date);
  const name = cleanNoteName(`${day} ${cleanNoteName(title) || FALLBACK_TITLE}`);
  return `Meetings/${day.slice(0, 4)}/${day.slice(5, 7)}/${name}.md`;
}

/** The vault's commit message for this meeting: `Meeting: <date> <title>`. */
export function meetingCommitMessage(input: Pick<MeetingInput, 'date' | 'title'>): string {
  const fileName = meetingPath(input).split('/').at(-1) ?? '';
  return `Meeting: ${fileName.slice(0, -'.md'.length)}`;
}

/** Text on one line: runs of white space, line breaks included, become one space. */
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/** The people as `[[Name]]` links, each once: the name, else the address's local part; never made up. */
export function peopleLinks(input: Pick<MeetingInput, 'attendees'>): string[] {
  const links: string[] = [];
  for (const { name, email } of input.attendees) {
    const local = email?.includes('@') ? email.slice(0, email.indexOf('@')) : '';
    const linked = cleanNoteName(oneLine(name)) || cleanNoteName(local);
    if (linked !== '' && !links.includes(`[[${linked}]]`)) links.push(`[[${linked}]]`);
  }
  return links;
}

const aboutLink = (about: string) => {
  const trimmed = oneLine(about);
  if (trimmed.includes('[[')) return trimmed;
  const name = cleanNoteName(trimmed);
  return name === '' ? '' : `[[${name}]]`;
};

/** The first sentence of the summary, ending in `.`, `!` or `?`; null when the summary has no prose. */
function firstSentence(summary: string | undefined): string | null {
  const prose = (summary ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const paragraph = prose.join(' ');
  if (paragraph === '') return null;
  const sentence = /^.*?[.!?](?=\s|$)/.exec(paragraph)?.[0] ?? paragraph;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function fallbackSentence(date: string, people: readonly string[]): string {
  const names = people.map((link) => link.slice(2, -2));
  if (names.length === 0) return `Meeting on ${date}.`;
  const last = names.at(-1) ?? '';
  const listed = names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
  return `Meeting on ${date} with ${listed}.`;
}

function whenLine({ date, start, end }: MeetingInput): string {
  const from = oneLine(start ?? '');
  const to = oneLine(end ?? '');
  if (from === '') return `- When: ${date}`;
  return `- When: ${date} ${from}${to === '' ? '' : `–${to}`}`;
}

/** The opening sentence and the `- Key: value` lines, before any section. */
function headerLines(input: MeetingInput): string[] {
  const people = peopleLinks(input);
  const opening = firstSentence(input.summary) ?? fallbackSentence(input.date, people);
  const about = (input.about ?? []).map(aboutLink).filter((link) => link !== '');
  const source = oneLine(input.sourceUrl ?? '');
  return [
    `${opening} #meeting`,
    '',
    whenLine(input),
    ...(people.length === 0 ? [] : [`- With: ${people.join(', ')}`]),
    ...(about.length === 0 ? [] : [`- About: ${about.join(', ')}`]),
    ...(WEB_ADDRESS.test(source) ? [`- Source: ${source}`] : []),
  ];
}

const trimmedBlock = (value: string | undefined) =>
  (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');

const bullets = (items: readonly string[] | undefined) =>
  (items ?? [])
    .map((item) => oneLine(item).replace(/^[-*+]\s+/, ''))
    .filter((item) => item !== '')
    .map((item) => `- ${item}`)
    .join('\n');

function turnText({ speaker, time, text }: TranscriptTurn): string {
  const words = oneLine(text);
  if (words === '') return '';
  const who = oneLine(speaker);
  const stamp = oneLine(time ?? '');
  const lead = [who === '' ? '' : `**${who}**`, stamp === '' ? '' : `[${stamp}]`]
    .filter((part) => part !== '')
    .join(' ');
  return lead === '' ? words : `${lead} ${words}`;
}

/** The note's sections in contract order, the empty ones left out. */
export function noteSections(input: MeetingInput): NoteSection[] {
  const bodies: Record<string, string> = {
    Summary: trimmedBlock(input.summary),
    Decisions: bullets(input.decisions),
    'Next steps': bullets(input.nextSteps),
    Notes: trimmedBlock(input.notes),
    Transcript: (input.transcript ?? [])
      .map(turnText)
      .filter((turn) => turn !== '')
      .join('\n\n'),
  };
  return SECTION_ORDER.map((heading) => ({ heading, body: bodies[heading] ?? '' })).filter(
    ({ body }) => body !== '',
  );
}

export const sectionText = ({ heading, body }: NoteSection) => `## ${heading}\n\n${body}`;

/**
 * A meeting note in the vault contract's shape: no frontmatter; an opening
 * sentence (the summary's first, else "Meeting on <date> with …") tagged
 * `#meeting`; `When`, `With`, `About` lines; then Summary, Decisions, Next
 * steps, Notes and Transcript, each only when it has something in it. The
 * same input always gives the same bytes, ending in one newline.
 */
export function meetingNote(input: MeetingInput): MeetingNote {
  const path = meetingPath(input);
  const blocks = [headerLines(input).join('\n'), ...noteSections(input).map(sectionText)];
  return { path, text: `${blocks.join('\n\n')}\n` };
}
