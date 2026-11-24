import type { VaultPath } from '../vault/index.ts';

/*
 * The meetings waiting for Claude: one plain note the app adds a line to when
 * it imports a new meeting, and Claude takes the line out of once the
 * meeting's note holds its summary. Every line is a link to the note, so a
 * rename in the app follows it, and the person can read the list in the app.
 * A line is the meeting's whole record here: nothing else is kept. Any
 * line that is not an entry (the header, a word the person typed) is left
 * as it is, and kept from both sides when two Macs' queues are merged.
 */

/** Where the queue lives: beside the meetings, as an ordinary note. */
export const MEETING_QUEUE_PATH: VaultPath = 'Meetings/Processing queue.md';

/** What a new queue starts with, saying what it is to the person and to Claude. */
export const MEETING_QUEUE_HEADER = [
  'Meetings waiting for Claude to summarize them. DFAI Lite adds a line here when it imports a new meeting.',
  '',
  'Claude works this list with the `meeting-processing` skill and removes a line only once that meeting’s note is saved with its summary. A line it could not do stays, with the reason after it.',
  '',
].join('\n');

/** The line that opens Claude's summary block in a meeting note: the note is done. */
export const MEETING_SUMMARY_MARKER = '<!-- dfai-lite:summary v1 -->';

/** Whether a meeting note already holds Claude's summary block. */
export const hasMeetingSummary = (note: string): boolean =>
  linesOf(note).some((line) => line.trim() === MEETING_SUMMARY_MARKER);

/** A meeting to put in the queue: its note, and the day it was added (`YYYY-MM-DD`). */
export interface QueuedMeeting {
  readonly path: VaultPath;
  readonly added: string;
}

const ENTRY = /^- \[\[([^\][|#\r\n]+)\]\]/;
const NOTE_SUFFIX = '.md';

/** The link a line writes for a note: its path, without `.md`. */
const linkTargetOf = (path: VaultPath): string =>
  path.endsWith(NOTE_SUFFIX) ? path.slice(0, -NOTE_SUFFIX.length) : path;

/** The note a queue line names, or null when the line is not an entry. */
function noteOfLine(line: string): VaultPath | null {
  const match = ENTRY.exec(line);
  return match === null ? null : `${(match[1] as string).trim()}${NOTE_SUFFIX}`;
}

/** What Claude adds to a line it could not do. */
const NOT_PROCESSED = ' — not processed:';
/** A line git writes into a file it could not merge. */
const CONFLICT_MARKER = /^(?:<{7}|={7}|>{7}|\|{7})(?:\s|$)/;

/** The file's lines, each without its line ending. */
const linesOf = (text: string): string[] => text.split('\n').map((line) => line.replace(/\r$/, ''));

/** The line ending the file already uses: CRLF when it has one, else LF. */
const lineEndingOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n');

/** The notes the queue lists, in its order, each once. */
export function queuedMeetings(text: string): VaultPath[] {
  const notes: VaultPath[] = [];
  for (const line of linesOf(text)) {
    const note = noteOfLine(line);
    if (note !== null && !notes.includes(note)) notes.push(note);
  }
  return notes;
}

/** `text` with `lines` after it, on lines of their own, in the file's own line ending. */
function appended(text: string, lines: readonly string[]): string {
  if (lines.length === 0) return text;
  const eol = lineEndingOf(text);
  const base = text === '' || text.endsWith('\n') ? text : `${text}${eol}`;
  return `${base}${lines.join(eol)}${eol}`;
}

/**
 * The queue with a line for each meeting it does not list yet, after the
 * lines it has. `text` null (no queue yet) starts one with its header. The
 * same text comes back when every meeting is already listed: a note is
 * never queued twice.
 */
export function queueMeetings(text: string | null, meetings: readonly QueuedMeeting[]): string {
  const current = text ?? MEETING_QUEUE_HEADER;
  const listed = new Set(queuedMeetings(current));
  const lines: string[] = [];
  for (const { path, added } of meetings) {
    if (listed.has(path)) continue;
    listed.add(path);
    lines.push(`- [[${linkTargetOf(path)}]] added ${added}`);
  }
  return appended(current, lines);
}

const hasReason = (line: string): boolean => line.includes(NOT_PROCESSED);

/** `text` with the line `from` written as `to`, its line ending kept. */
function rewritten(text: string, from: string, to: string): string {
  const raw = text.split('\n');
  const at = raw.findIndex((line) => line.replace(/\r$/, '') === from);
  if (at === -1) return text;
  raw[at] = `${to}${(raw[at] as string).endsWith('\r') ? '\r' : ''}`;
  return raw.join('\n');
}

/**
 * Both Macs' queues as one, for a sync where both changed it: this Mac's
 * text, then each of the other's lines this one lacks, as the other wrote
 * them: entries for notes this one does not list, and any other line (one
 * the person typed). An entry both list keeps this Mac's line, unless only
 * the other's says why Claude could not do it. Blank lines and git's
 * conflict markers are not carried. Nothing queued or typed on either side
 * is lost; a line one side had already removed may come back, which is
 * harmless, because a meeting that has its summary is only taken off again.
 */
export function mergeMeetingQueues(ours: string, theirs: string): string {
  const entries = new Map<VaultPath, string>();
  const others = new Set<string>();
  for (const line of linesOf(ours)) {
    const note = noteOfLine(line);
    if (note === null) others.add(line);
    else if (!entries.has(note)) entries.set(note, line);
  }
  let text = ours;
  const lines: string[] = [];
  for (const line of linesOf(theirs)) {
    if (line.trim() === '' || CONFLICT_MARKER.test(line)) continue;
    const note = noteOfLine(line);
    const held = note === null ? undefined : entries.get(note);
    if (note === null) {
      if (!others.has(line)) lines.push(line);
      others.add(line);
    } else if (held === undefined) {
      entries.set(note, line);
      lines.push(line);
    } else if (!hasReason(held) && hasReason(line)) {
      text = rewritten(text, held, line);
      entries.set(note, line);
    }
  }
  return appended(text, lines);
}
