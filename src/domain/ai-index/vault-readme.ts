import { fileText, type IndexFile } from './text.ts';
import { vaultMapLines } from './vault-map.ts';

/** The vault's root README: the map an AI reads first. */
export const README_PATH = 'README.md';

/** The markers around the generated part. Everything outside them is the owner's, never changed. */
export const MAP_START =
  '<!-- dfai-lite:map:start (generated from the notes: edits between these markers are replaced) -->';
export const MAP_END = '<!-- dfai-lite:map:end -->';

/** Lines the whole README should stay under, with a hand-written part of a sensible size. */
export const README_LINE_BUDGET = 150;

/** What to write at `README.md`, or why it is left alone. */
export type ReadmeUpdate =
  | { readonly kind: 'write'; readonly text: string }
  | { readonly kind: 'refused'; readonly reason: string };

/** What a vault with no README starts with, above the map. */
const FIRST_README = [
  '# About this vault',
  '',
  'Describe the vault here, for Claude and for yourself: the projects and areas that matter now, the people who come up most, what to read first. The index never changes anything outside the generated map below.',
  '',
];

/**
 * The README with a fresh map: the generated block between the markers is
 * replaced and every byte outside them kept. A README without markers keeps
 * its text byte for byte with the map appended below it; no README gets a
 * short hand-written part to fill in. Markers that are not exactly one start
 * before one end are refused: guessing could eat the owner's text.
 */
export function vaultReadme(existing: string | null, notes: readonly IndexFile[]): ReadmeUpdate {
  const block = fileText([MAP_START, ...vaultMapLines(notes), MAP_END]);
  if (existing === null) return { kind: 'write', text: fileText(FIRST_README) + block };
  const starts = occurrences(existing, MAP_START);
  const ends = occurrences(existing, MAP_END);
  if (starts.length === 0 && ends.length === 0) {
    const gap = existing === '' ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    return { kind: 'write', text: `${existing}${gap}${block}` };
  }
  const [start] = starts;
  const [end] = ends;
  if (
    starts.length !== 1 ||
    ends.length !== 1 ||
    start === undefined ||
    end === undefined ||
    end < start
  ) {
    return {
      kind: 'refused',
      reason: `${README_PATH} needs exactly one "${MAP_START}" line before one "${MAP_END}" line; it was left as it is.`,
    };
  }
  const after = existing.slice(end + MAP_END.length);
  // The block ends in its own newline; the end marker's line ending (LF or CRLF) goes with the old block.
  const tail = after.replace(/^\r?\n/, '');
  return { kind: 'write', text: `${existing.slice(0, start)}${block}${tail}` };
}

function occurrences(text: string, marker: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + marker.length)) {
    found.push(at);
  }
  return found;
}
