import type { MeetingInput } from './meeting-input.ts';
import {
  SECTION_ORDER,
  meetingNote,
  meetingPath,
  noteSections,
  sectionText,
} from './meeting-note.ts';
import {
  hasInlineTranscript,
  linkedTranscriptOf,
  transcriptBody,
  transcriptNameOf,
  transcriptToWrite,
  withTranscriptLink,
  type TranscriptNote,
} from './meeting-transcript.ts';

const FENCE = /^\s*(?:```|~~~)/;
const SECTION_HEADING = /^##[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/;

/** Where each contract section already starts in a note: its name (lower case) → line number. */
function sectionStarts(lines: readonly string[]): Map<string, number> {
  const starts = new Map<string, number>();
  let inFence = false;
  lines.forEach((line, at) => {
    if (FENCE.test(line)) inFence = !inFence;
    const name = inFence ? undefined : SECTION_HEADING.exec(line)?.[1]?.toLowerCase();
    if (name !== undefined && !starts.has(name)) starts.set(name, at);
  });
  return starts;
}

const rank = (heading: string) =>
  SECTION_ORDER.findIndex((each) => each.toLowerCase() === heading.toLowerCase());

/** The line a new section goes before: the first later contract section the note has; else the end. */
function insertionLine(heading: string, starts: ReadonlyMap<string, number>, end: number): number {
  const later = SECTION_ORDER.slice(rank(heading) + 1)
    .map((each) => starts.get(each.toLowerCase()))
    .filter((at): at is number => at !== undefined);
  return later.length === 0 ? end : Math.min(...later);
}

/** `lines` with `block` inserted before line `at`, with a blank line each side; no existing line changes. */
function inserted(lines: readonly string[], at: number, block: string): string[] {
  const before = lines.slice(0, at);
  const after = lines.slice(at);
  const lead = before.length > 0 && before.at(-1)?.trim() !== '' ? [''] : [];
  return [...before, ...lead, ...block.split('\n'), ...(after.length === 0 ? [] : ['', ...after])];
}

/**
 * The note with its `- Transcript:` line when the input brings turns and the
 * note has no transcript yet, linked nor inline: an older note keeping its
 * transcript inline is left as it is (the split tool moves it out).
 */
function withTranscript(text: string, input: MeetingInput, path: string): string {
  if (transcriptBody(input) === '' || hasInlineTranscript(text)) return text;
  return withTranscriptLink(text, transcriptNameOf(path));
}

/**
 * The vault contract's "if that file exists, it is the same meeting: add to
 * it". Each section the input has and the note lacks is added in contract
 * order, and a transcript arriving after the summary adds the `- Transcript:`
 * line (the writer creates the transcript note); a section the note already
 * has, and everything else in it, is left byte for byte, since a person may
 * have edited it. So merging the same input twice changes nothing. An empty
 * note is written whole. `path` is the note's own, which names its transcript.
 */
export function mergeMeetingNote(
  existingText: string,
  input: MeetingInput,
  path: string = meetingPath(input),
): string {
  if (existingText.trim() === '') return meetingNote(input, path).text;
  const lines = existingText.replace(/\n$/, '').split('\n');
  let changed: string[] = lines;
  for (const section of noteSections(input)) {
    const starts = sectionStarts(changed);
    if (starts.has(section.heading.toLowerCase())) continue;
    const at = insertionLine(section.heading, starts, changed.length);
    changed = inserted(changed, at, sectionText(section));
  }
  const merged = changed === lines ? existingText : `${changed.join('\n')}\n`;
  return withTranscript(merged, input, path);
}

/** What a writer puts in the vault for one meeting: the meeting note's text, and a transcript note to create first. */
export interface MeetingWrite {
  readonly text: string;
  /** Null unless this write adds the note's `- Transcript:` line. Created, never written over. */
  readonly transcript: TranscriptNote | null;
}

/**
 * {@link mergeMeetingNote}, with the transcript note to create when the merge
 * is what links it. Writers create the transcript note first, then write the
 * meeting note, so its link never points at nothing.
 */
export function meetingWrite(
  existingText: string,
  input: MeetingInput,
  path: string = meetingPath(input),
): MeetingWrite {
  const text = mergeMeetingNote(existingText, input, path);
  const linksAlready = linkedTranscriptOf(existingText) !== null;
  return { text, transcript: linksAlready ? null : transcriptToWrite(text, input, path) };
}
