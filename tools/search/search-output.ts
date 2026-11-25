// What the search command prints: plain text for an AI reader. One block per
// note, no colours or decoration, so every line carries information.
import type { SearchHit, SearchResult } from '../../src/domain/note-search/index.ts';

/** A file time as a local date, `2026-11-24`. */
export function localDate(ms: number): string {
  const date = new Date(ms);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The whole printout for a search, ending in a newline. */
export function formatResult(
  result: SearchResult,
  { query, titleOnly }: { query: string; titleOnly: boolean },
): string {
  if (result.unknownLinkTarget !== undefined) {
    return `No note answers to [[${result.unknownLinkTarget}]]. Find its name with --title "<words>".\n`;
  }
  const asked = query.trim() === '' ? 'the filters' : `the query ${query.trim()}`;
  if (result.total === 0) {
    return `No notes match ${asked}. Try fewer words, a shorter word, no filters, or --transcripts.\n`;
  }
  const shown = result.hits.length;
  const matched = `${result.total} ${result.total === 1 ? 'note matches' : 'notes match'} ${asked}`;
  const header =
    shown < result.total ? `${matched}; the best ${shown} (--limit for more):` : `${matched}:`;
  return `${[header, ...result.hits.map((hit) => hitBlock(hit, titleOnly))].join('\n')}\n`;
}

/** `path | #tags | changed date`, then its lines (`  12: text`) or its first sentence. */
function hitBlock(hit: SearchHit, titleOnly: boolean): string {
  const tags = hit.tags.length === 0 ? '' : ` | ${hit.tags.map((tag) => `#${tag}`).join(' ')}`;
  const head = `${hit.path}${tags} | changed ${localDate(hit.modifiedMs)}`;
  if (titleOnly) return head;
  const detail =
    hit.lines.length > 0
      ? hit.lines.map(({ line, text }) => `  ${line}: ${text}`)
      : hit.summary === ''
        ? []
        : [`  = ${hit.summary}`];
  return [head, ...detail].join('\n');
}
