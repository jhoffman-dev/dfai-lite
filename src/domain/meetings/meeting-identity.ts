import type { MeetingInput } from './meeting-input.ts';
import { meetingPath } from './meeting-note.ts';

/**
 * A short hash of the text: 32-bit FNV-1a over its UTF-16 code units, as 8
 * hex digits, as DFAI names a second copy. Not for security; it tells one
 * meeting's id from another's where the id cannot go in a file name.
 */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Where a meeting goes when another meeting from the same provider already
 * holds its plain path — two `1:1`s on one day: DFAI's
 * `<YYYY-MM-DD> <title> (<provider> <8 hex>).md`, the hash of provider and id.
 */
export function meetingCopyPath(
  input: Pick<MeetingInput, 'date' | 'title'>,
  { provider, id }: { provider: string; id: string },
): string {
  const plain = meetingPath(input);
  return `${plain.slice(0, -'.md'.length)} (${provider} ${shortHash(`${provider}\n${id}`)}).md`;
}

const SOURCE_LINE = /^- Source: (\S+)[ \t]*$/;
const SECTION = /^##[ \t]/;

/**
 * The address a meeting note's `- Source:` line gives, read from the lines
 * before its first section; null when it has none. How a note is known to
 * hold a provider's meeting when the ledger has lost it.
 */
export function meetingSourceOf(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (SECTION.test(line)) return null;
    const source = SOURCE_LINE.exec(line)?.[1];
    if (source !== undefined) return source;
  }
  return null;
}
