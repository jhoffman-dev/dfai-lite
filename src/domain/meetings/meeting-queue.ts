import type { VaultPath } from '../vault/index.ts';

/*
 * The meetings waiting for Claude: one plain note the app adds a line to when
 * it imports a new meeting, and Claude takes the line out of once the
 * meeting's note holds its summary. Every line is a link to the note, so a
 * rename in the app follows it, and the person can read the list in the app.
 * A line is the meeting's whole record here: nothing else is kept, and any
 * line that is not an entry (the header, a word the person typed) is left
 * as it is.
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

const linesOf = (text: string): string[] => text.split('\n').map((line) => line.replace(/\r$/, ''));

/** The notes the queue lists, in its order, each once. */
export function queuedMeetings(text: string): VaultPath[] {
  const notes: VaultPath[] = [];
  for (const line of linesOf(text)) {
    const note = noteOfLine(line);
    if (note !== null && !notes.includes(note)) notes.push(note);
  }
  return notes;
}

/** `text` with `lines` after it, on lines of their own. */
function appended(text: string, lines: readonly string[]): string {
  if (lines.length === 0) return text;
  const base = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return `${base}${lines.join('\n')}\n`;
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

/**
 * Both Macs' queues as one, for a sync where both changed it: this Mac's
 * text, then each of the other's entry lines for a note this one does not
 * list, as the other wrote them. Nothing queued on either side is lost; a
 * line one side had already removed may come back, which is harmless,
 * because a meeting that has its summary is only taken off the list again.
 */
export function mergeMeetingQueues(ours: string, theirs: string): string {
  const listed = new Set(queuedMeetings(ours));
  const lines: string[] = [];
  for (const line of linesOf(theirs)) {
    const note = noteOfLine(line);
    if (note === null || listed.has(note)) continue;
    listed.add(note);
    lines.push(line);
  }
  return appended(ours, lines);
}
