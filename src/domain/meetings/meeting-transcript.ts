import { TRANSCRIPTS_FOLDER, noteTitle, type VaultPath } from '../vault/index.ts';
import type { MeetingInput, TranscriptTurn } from './meeting-input.ts';

/*
 * A meeting's transcript is a note of its own, so the meeting note stays
 * short for the person and for Claude:
 *
 *   Transcripts/<YYYY>/<MM>/<meeting note's name> (transcript).md
 *
 * Its first line says whose transcript it is and links the meeting note back;
 * the meeting note carries one `- Transcript: [[… (transcript)]]` line in its
 * header list. The ` (transcript)` suffix keeps the two names apart, so a
 * `[[link]]` to either never resolves to the other.
 */

/** A note to write: where, and its whole text. */
export interface TranscriptNote {
  readonly path: VaultPath;
  readonly text: string;
}

/** A meeting note with its inline `## Transcript` moved out: both notes' new text. */
export interface SplitTranscript {
  readonly kind: 'split';
  readonly meeting: string;
  readonly transcript: TranscriptNote;
  /** The inline section's body, exactly as it stood, its outer blank lines aside. */
  readonly moved: string;
}

/** A meeting note whose inline transcript a tool must not move: why, for the person. */
export interface RefusedSplit {
  readonly kind: 'refused';
  readonly reason: string;
}

const SUFFIX = ' (transcript)';
const DATED = /^(\d{4})-(0[1-9]|1[0-2])-\d{2}\b/;
const LINK_LINE = /^- Transcript: \[\[([^\][|#\r\n]+)(?:[|#][^\]\r\n]*)?\]\][ \t]*\r?$/;
const HEADER_ITEM = /^- [A-Za-z][\w ]*:/;
const SECTION_HEADING = /^##[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/;
/** A level 1 or 2 heading: where an inline transcript section ends. */
const TOP_HEADING = /^(#{1,2})[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/;
/** A line that would be a level 1 or 2 heading anywhere, fenced or not: never part of a transcript. */
const ANY_TOP_HEADING = /^ {0,3}#{1,2}(?:[ \t]|\r?$)/;
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const SUMMARY_MARKER = /^<!-- dfai-lite:summary v1 -->\r?$/;

/** Text on one line: runs of white space, line breaks included, become one space. */
export const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** The transcript note's name for a meeting note: its own name, ` (transcript)` after it. */
export const transcriptNameOf = (meetingPath: VaultPath): string =>
  `${noteTitle(meetingPath)}${SUFFIX}`;

/**
 * Where a meeting note's transcript goes: `Transcripts/<YYYY>/<MM>/` from the
 * date its name starts with, else straight under `Transcripts/`.
 */
export function transcriptPathOf(meetingPath: VaultPath): VaultPath {
  const name = transcriptNameOf(meetingPath);
  const dated = DATED.exec(name);
  const folder =
    dated === null ? TRANSCRIPTS_FOLDER : `${TRANSCRIPTS_FOLDER}/${dated[1]}/${dated[2]}`;
  return `${folder}/${name}.md`;
}

/** The meeting note's header line that links the transcript note named `name`. */
export const transcriptLinkLine = (name: string): string => `- Transcript: [[${name}]]`;

/** The note a meeting note's `- Transcript:` line links, read before its first section; null without one. */
export function linkedTranscriptOf(text: string): string | null {
  for (const line of text.split('\n')) {
    if (SECTION_HEADING.test(line)) return null;
    const name = LINK_LINE.exec(line)?.[1];
    if (name !== undefined) return name.trim();
  }
  return null;
}

/** The first line of a transcript note, then the turns: the whole note, ending in one line ending. */
export function transcriptNoteText(meetingPath: VaultPath, body: string, eol = '\n'): string {
  const opening = `Transcript of the meeting [[${noteTitle(meetingPath)}]].`;
  return `${opening}${eol}${eol}${body.replace(/(?:\r?\n)+$/, '')}${eol}`;
}

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

/** The input's turns, one paragraph each, as a transcript note writes them; '' with none. */
export const transcriptBody = (input: Pick<MeetingInput, 'transcript'>): string =>
  (input.transcript ?? [])
    .map(turnText)
    .filter((turn) => turn !== '')
    .join('\n\n');

/** The transcript note an input carries for the meeting note at `meetingPath`; null with no turns. */
export function transcriptNote(
  input: Pick<MeetingInput, 'transcript'>,
  meetingPath: VaultPath,
): TranscriptNote | null {
  const body = transcriptBody(input);
  if (body === '') return null;
  return { path: transcriptPathOf(meetingPath), text: transcriptNoteText(meetingPath, body) };
}

/**
 * The transcript note to create beside a meeting note now reading
 * `meetingText`: the input's, when the note links it by its own name; null
 * when the input has no turns or the note does not link it (an older note
 * keeping its transcript inline). Writers create it, never over another.
 */
export function transcriptToWrite(
  meetingText: string,
  input: Pick<MeetingInput, 'transcript'>,
  meetingPath: VaultPath,
): TranscriptNote | null {
  if (linkedTranscriptOf(meetingText) !== transcriptNameOf(meetingPath)) return null;
  return transcriptNote(input, meetingPath);
}

/**
 * Whether each line is code: inside a fenced block, its fence lines
 * included. CommonMark's rule: a fence closes only on a line of the same
 * character, at least as long as the one that opened it, and nothing else.
 */
function codeLines(lines: readonly string[]): boolean[] {
  const code: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    if (open === null) {
      open = FENCE_OPEN.exec(line)?.[1] ?? null;
      code.push(open !== null);
      continue;
    }
    code.push(true);
    const closer = new RegExp(`^ {0,3}${open[0] === '`' ? '`' : '~'}{${open.length},}[ \\t]*\\r?$`);
    if (closer.test(line)) open = null;
  }
  return code;
}

interface Heading {
  readonly at: number;
  readonly level: number;
  /** Lower case. */
  readonly name: string;
}

/** Each level 1 and 2 heading outside code, in order. */
function headingsOf(lines: readonly string[]): Heading[] {
  const code = codeLines(lines);
  const found: Heading[] = [];
  lines.forEach((line, at) => {
    const match = code[at] === true ? null : TOP_HEADING.exec(line);
    if (match !== null) {
      found.push({
        at,
        level: (match[1] as string).length,
        name: (match[2] as string).toLowerCase(),
      });
    }
  });
  return found;
}

const isTranscriptHeading = ({ level, name }: Heading): boolean =>
  level === 2 && name === 'transcript';

/** Whether a meeting note still holds its transcript inline, under `## Transcript`. */
export const hasInlineTranscript = (text: string): boolean =>
  headingsOf(text.split('\n')).some(isTranscriptHeading);

const isBlank = (line: string): boolean => line.trim() === '';

/** Where the header list ends: the line after its last `- Key:` item, before any section or summary. */
function headerEnd(lines: readonly string[]): number | null {
  let last: number | null = null;
  for (const [at, line] of lines.entries()) {
    if (SECTION_HEADING.test(line) || SUMMARY_MARKER.test(line)) break;
    if (HEADER_ITEM.test(line)) last = at + 1;
  }
  return last;
}

/** The first line of the note's body after its header: a section, the summary block, or the end. */
function bodyStart(lines: readonly string[]): number {
  const at = lines.findIndex((line) => SECTION_HEADING.test(line) || SUMMARY_MARKER.test(line));
  return at === -1 ? lines.length : at;
}

/** `lines` without the blank ones at their end. */
function withoutTrailingBlanks(lines: readonly string[]): string[] {
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1] as string)) end -= 1;
  return lines.slice(0, end);
}

/**
 * The meeting note with a `- Transcript:` line linking the note named
 * `transcriptName`: after the last item of its header list, else on its own
 * before the first section. Every other line stays as it was. A note that
 * already links a transcript comes back as is.
 */
export function withTranscriptLink(text: string, transcriptName: string): string {
  if (linkedTranscriptOf(text) !== null) return text;
  const lines = text.split('\n');
  const blank = carriageOf(text);
  const line = `${transcriptLinkLine(transcriptName)}${blank}`;
  const after = headerEnd(lines);
  if (after !== null) return [...lines.slice(0, after), line, ...lines.slice(after)].join('\n');
  const at = bodyStart(lines);
  const before = withoutTrailingBlanks(lines.slice(0, at));
  const rest = lines.slice(at);
  const lead = before.length > 0 ? [blank, line] : [line];
  return [...before, ...lead, ...(rest.length > 0 ? [blank, ...rest] : [''])].join('\n');
}

/** What a line ends with before its `\n` in this text: `\r` in a CRLF note, else nothing. */
const carriageOf = (text: string): string => (text.includes('\r\n') ? '\r' : '');

/** Lines without the blank ones at either end. */
function trimmedLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start] as string)) start += 1;
  while (end > start && isBlank(lines[end - 1] as string)) end -= 1;
  return lines.slice(start, end);
}

/**
 * Why the lines to move may hold more than transcript, or null: a code fence
 * left open (it would hide the headings after it), a level 1 or 2 heading
 * even inside code, or the summary block.
 */
function notOnlyTranscript(range: readonly string[]): string | null {
  if (codeLines([...range, '']).at(-1) === true) {
    return 'its transcript has a code fence that never closes, so it may hold the sections after it';
  }
  if (range.some((line) => ANY_TOP_HEADING.test(line))) {
    return 'its transcript holds a heading, so it may hold more than the transcript';
  }
  if (range.some((line) => SUMMARY_MARKER.test(line))) {
    return 'its transcript holds Claude’s summary block';
  }
  return null;
}

/** The transcript section's lines: from its heading to the next level 1 or 2 heading, or the end. */
function transcriptRange(lines: readonly string[]): { start: number; end: number } | null {
  const headings = headingsOf(lines);
  const index = headings.findIndex(isTranscriptHeading);
  if (index === -1) return null;
  const start = (headings[index] as Heading).at;
  return { start, end: headings[index + 1]?.at ?? lines.length };
}

/**
 * Moves a meeting note's inline `## Transcript` section into a transcript
 * note: the section's body, every byte of it but its outer blank lines, goes
 * to the transcript note; the meeting note loses that section (and the blank
 * lines before it) and gains the `- Transcript:` line, in the note's own line
 * ending. The section ends at the next level 1 or 2 heading. Null when there
 * is nothing to move (no inline transcript, or an empty one); refused when
 * the section may hold more than transcript, or the note already links a
 * transcript note: a person sorts those out, not a tool.
 */
export function splitInlineTranscript(
  meetingPath: VaultPath,
  text: string,
  transcriptPath: VaultPath = transcriptPathOf(meetingPath),
): SplitTranscript | RefusedSplit | null {
  const lines = text.split('\n');
  const range = transcriptRange(lines);
  if (range === null) return null;
  const body = lines.slice(range.start + 1, range.end);
  const moved = trimmedLines(body).join('\n').replace(/\r$/, '');
  if (moved.trim() === '') return null;
  if (linkedTranscriptOf(text) !== null) {
    return {
      kind: 'refused',
      reason: 'it already links a transcript note and still holds one inline',
    };
  }
  if (headingsOf(lines).filter(isTranscriptHeading).length > 1) {
    return { kind: 'refused', reason: 'it holds two `## Transcript` sections' };
  }
  const reason = notOnlyTranscript(body);
  if (reason !== null) return { kind: 'refused', reason };
  const blank = carriageOf(text);
  const before = withoutTrailingBlanks(lines.slice(0, range.start));
  const after = lines.slice(range.end);
  const rest = trimmedLines(after).length === 0 ? [''] : [blank, ...after];
  const kept = before.length === 0 ? rest.slice(1) : [...before, ...rest];
  const meeting = withTranscriptLink(kept.join('\n'), noteTitle(transcriptPath));
  const eol = blank === '' ? '\n' : '\r\n';
  const transcript = { path: transcriptPath, text: transcriptNoteText(meetingPath, moved, eol) };
  return { kind: 'split', meeting, transcript, moved };
}
