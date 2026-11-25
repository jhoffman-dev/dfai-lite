import { composed } from '../links/index.ts';

/** One thing a note must contain: a word, or a quoted phrase, folded for comparing. */
export interface Needle {
  readonly folded: string;
  readonly phrase: boolean;
}

/** Text as search compares it: accents composed one way, case folded. */
export const foldForSearch = (text: string): string => composed(text).toLowerCase();

const PIECE = /"([^"]*)"|(\S+)/g;

/**
 * The needles in a query: each `"quoted phrase"` whole, every other word on
 * its own. A phrase keeps its inner spacing; an empty one is dropped. An
 * unclosed quote reads as a plain word. Each needle appears once.
 */
export function parseSearchQuery(query: string): readonly Needle[] {
  const needles: Needle[] = [];
  const seen = new Set<string>();
  for (const [, phrase, word] of query.matchAll(PIECE)) {
    const text = phrase ?? (word ?? '').replace(/"/g, '');
    const folded = foldForSearch(phrase === undefined ? text : text.trim());
    if (folded === '' || seen.has(folded)) continue;
    seen.add(folded);
    needles.push({ folded, phrase: phrase !== undefined });
  }
  return needles;
}
