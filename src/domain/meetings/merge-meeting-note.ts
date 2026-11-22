import type { MeetingInput } from './meeting-input.ts';
import { SECTION_ORDER, meetingNote, noteSections, sectionText } from './meeting-note.ts';

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
 * The vault contract's "if that file exists, it is the same meeting: add to
 * it". Each section the input has and the note lacks (a transcript arriving
 * after the summary, say) is added in contract order; a section the note
 * already has, and everything else in it, is left byte for byte, since a
 * person may have edited it. So merging the same input twice changes nothing.
 * An empty note is written whole.
 */
export function mergeMeetingNote(existingText: string, input: MeetingInput): string {
  if (existingText.trim() === '') return meetingNote(input).text;
  const lines = existingText.replace(/\n$/, '').split('\n');
  let changed: string[] = lines;
  for (const section of noteSections(input)) {
    const starts = sectionStarts(changed);
    if (starts.has(section.heading.toLowerCase())) continue;
    const at = insertionLine(section.heading, starts, changed.length);
    changed = inserted(changed, at, sectionText(section));
  }
  return changed === lines ? existingText : `${changed.join('\n')}\n`;
}
