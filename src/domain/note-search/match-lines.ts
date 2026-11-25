import { foldForSearch, type Needle } from './search-query.ts';

/** A line of a note that holds a match: its number (from 1) and its text, trimmed to fit. */
export interface MatchedLine {
  readonly line: number;
  readonly text: string;
}

/** Longest line shown; a longer one is cut to a window around its first match. */
export const MAX_LINE_LENGTH = 160;
/** How much of a long line is kept before its first match. */
const LEAD = 50;
const ELLIPSIS = '…';

const HEADING = /^#{1,6}\s/;

/** Whether a line is a markdown heading (`## Plan`). */
export const isHeadingLine = (line: string): boolean => HEADING.test(line);

interface Candidate {
  readonly index: number;
  readonly text: string;
  readonly hits: number;
  readonly heading: boolean;
  readonly firstAt: number;
}

/**
 * The lines of a note worth showing for a query, at most `max`: the lines
 * holding the most needles first, a heading before body text on a tie, then
 * the earliest; returned in the order they stand in the note.
 */
export function matchingLines(
  text: string,
  needles: readonly Needle[],
  max: number,
): readonly MatchedLine[] {
  if (needles.length === 0 || max <= 0) return [];
  const candidates: Candidate[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    const folded = foldForSearch(line);
    const positions = needles.map(({ folded: needle }) => folded.indexOf(needle));
    const found = positions.filter((at) => at !== -1);
    if (found.length === 0) return;
    const firstAt = Math.min(...found);
    candidates.push({
      index,
      text: line,
      hits: found.length,
      heading: isHeadingLine(line),
      firstAt,
    });
  });
  return candidates
    .sort((a, b) => b.hits - a.hits || Number(b.heading) - Number(a.heading) || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map(({ index, text: line, firstAt }) => ({ line: index + 1, text: shortened(line, firstAt) }));
}

/**
 * A line cut to `MAX_LINE_LENGTH`, keeping its match in view. Folding keeps
 * the length of almost all text, so the match position found on the folded
 * line is close enough to cut the line itself by.
 */
function shortened(line: string, matchAt: number): string {
  if (line.length <= MAX_LINE_LENGTH) return line;
  const start = Math.max(0, Math.min(matchAt - LEAD, line.length - MAX_LINE_LENGTH));
  const room = MAX_LINE_LENGTH - (start > 0 ? 1 : 0);
  const end = Math.min(line.length, start + room);
  const cut = line.slice(start, end - (end < line.length ? 1 : 0));
  return `${start > 0 ? ELLIPSIS : ''}${cut}${end < line.length ? ELLIPSIS : ''}`;
}
