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
  readonly meeting: string;
  readonly transcript: TranscriptNote;
  /** The inline section's body, exactly as it stood, its outer blank lines aside. */
  readonly moved: string;
}

const SUFFIX = ' (transcript)';
const DATED = /^(\d{4})-(0[1-9]|1[0-2])-\d{2}\b/;
const LINK_LINE = /^- Transcript: \[\[([^\][|#\r\n]+)(?:[|#][^\]\r\n]*)?\]\][ \t]*\r?$/;
const HEADER_ITEM = /^- [A-Za-z][\w ]*:/;
const SECTION_HEADING = /^##[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/;
const FENCE = /^\s*(?:```|~~~)/;
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

/** The first line of a transcript note, then the turns: the whole note, ending in one newline. */
export function transcriptNoteText(meetingPath: VaultPath, body: string): string {
  const opening = `Transcript of the meeting [[${noteTitle(meetingPath)}]].`;
  return `${opening}\n\n${body.replace(/\n+$/, '')}\n`;
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

/** Each `## ` heading's line number and lower-case name, outside code fences. */
function headingsOf(lines: readonly string[]): { at: number; name: string }[] {
  const found: { at: number; name: string }[] = [];
  let inFence = false;
  lines.forEach((line, at) => {
    if (FENCE.test(line)) inFence = !inFence;
    const name = inFence ? undefined : SECTION_HEADING.exec(line)?.[1];
    if (name !== undefined) found.push({ at, name: name.toLowerCase() });
  });
  return found;
}

/** Whether a meeting note still holds its transcript inline, under `## Transcript`. */
export const hasInlineTranscript = (text: string): boolean =>
  headingsOf(text.split('\n')).some(({ name }) => name === 'transcript');

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
  const eol = lines[0]?.endsWith('\r') === true ? '\r' : '';
  const line = `${transcriptLinkLine(transcriptName)}${eol}`;
  const after = headerEnd(lines);
  if (after !== null) return [...lines.slice(0, after), line, ...lines.slice(after)].join('\n');
  const at = bodyStart(lines);
  const before = withoutTrailingBlanks(lines.slice(0, at));
  const rest = lines.slice(at);
  const lead = before.length > 0 ? ['', line] : [line];
  return [...before, ...lead, ...(rest.length > 0 ? ['', ...rest] : [''])].join('\n');
}

/** Lines without the blank ones at either end. */
function trimmedLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start] as string)) start += 1;
  while (end > start && isBlank(lines[end - 1] as string)) end -= 1;
  return lines.slice(start, end);
}

/**
 * Moves a meeting note's inline `## Transcript` section into a transcript
 * note: the section's body, every byte of it but its outer blank lines, goes
 * to the transcript note; the meeting note loses that section (and the blank
 * lines before it) and gains the `- Transcript:` line. Null when there is
 * nothing to move: no inline transcript, an empty one, or a note that
 * already links a transcript (a person sorts that out, not a tool).
 */
export function splitInlineTranscript(
  meetingPath: VaultPath,
  text: string,
  transcriptPath: VaultPath = transcriptPathOf(meetingPath),
): SplitTranscript | null {
  if (linkedTranscriptOf(text) !== null) return null;
  const lines = text.split('\n');
  const headings = headingsOf(lines);
  const index = headings.findIndex(({ name }) => name === 'transcript');
  if (index === -1) return null;
  const start = (headings[index] as { at: number }).at;
  const end = headings[index + 1]?.at ?? lines.length;
  const moved = trimmedLines(lines.slice(start + 1, end)).join('\n');
  if (moved.trim() === '') return null;
  const before = withoutTrailingBlanks(lines.slice(0, start));
  const after = lines.slice(end);
  const rest = trimmedLines(after).length === 0 ? [''] : ['', ...after];
  const kept = before.length === 0 ? rest.slice(1) : [...before, ...rest];
  const meeting = withTranscriptLink(kept.join('\n'), noteTitle(transcriptPath));
  const transcript = { path: transcriptPath, text: transcriptNoteText(meetingPath, moved) };
  return { meeting, transcript, moved };
}
