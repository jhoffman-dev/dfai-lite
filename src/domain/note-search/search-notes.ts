import { VaultIndex } from '../index/index.ts';
import { tagKey } from '../tags/index.ts';
import { noteTitle, type VaultPath } from '../vault/index.ts';
import { matchingLines, isHeadingLine, type MatchedLine } from './match-lines.ts';
import { foldForSearch, parseSearchQuery, type Needle } from './search-query.ts';
import { isSearchedPath } from './search-scope.ts';

/** A note as search reads it: its text, and when its file last changed (ms since the epoch). */
export interface SearchableNote {
  readonly path: VaultPath;
  readonly text: string;
  readonly modifiedMs: number;
}

/** What narrows a search. Every filter given must hold. */
export interface SearchFilters {
  /** Tags the note must carry, each with or without `#`; a tag also matches the tags under it. */
  readonly tags?: readonly string[] | undefined;
  /** A folder the note must be in, at any depth below it. */
  readonly folder?: string | undefined;
  /** Only notes whose file changed at or after this time (ms since the epoch). */
  readonly modifiedSinceMs?: number | undefined;
  /** Only notes with a link that opens this note (a name or a path, as a link is written). */
  readonly linksTo?: string | undefined;
  /** Match the query against note names only. */
  readonly titleOnly?: boolean | undefined;
  /** Also search `Transcripts/`. */
  readonly transcripts?: boolean | undefined;
}

export interface SearchRequest {
  readonly notes: readonly SearchableNote[];
  readonly query: string;
  readonly filters?: SearchFilters;
  readonly limit: number;
}

/** One note found, with what an AI reader needs to decide whether to open it. */
export interface SearchHit {
  readonly path: VaultPath;
  readonly title: string;
  readonly tags: readonly string[];
  readonly modifiedMs: number;
  /** Up to three lines holding a match; none for a search by title or by filters alone. */
  readonly lines: readonly MatchedLine[];
  /** The note's first sentence, given when no lines are. */
  readonly summary: string;
}

export interface SearchResult {
  /** How many notes matched, before the limit. */
  readonly total: number;
  readonly hits: readonly SearchHit[];
  /** The `linksTo` target when no note answers to it. */
  readonly unknownLinkTarget?: string;
}

/** Lines shown per note. */
export const LINES_PER_HIT = 3;

/** Weights of one needle's hits: a note named for it beats one with a heading on it, which beats body text. */
const TITLE_WEIGHT = 100;
const HEADING_WEIGHT = 20;
const MAX_BODY_HITS = 5;
/** A note whose name is the whole query goes first. */
const EXACT_TITLE_BONUS = 1000;

/**
 * The notes a query and filters find, best first. All needles must be in the
 * note (in its name alone with `titleOnly`). Rank: hits in the name, then in
 * headings, then in the body (each needle's body hits counted up to five);
 * equal scores put the most recently changed first, then the path. No query
 * lists the filtered notes newest first. Pure: the same notes and request
 * give the same answer.
 */
export function searchNotes({ notes, query, filters = {}, limit }: SearchRequest): SearchResult {
  const transcripts = filters.transcripts === true;
  const scoped = notes.filter(({ path }) => isSearchedPath(path, { transcripts }));
  const index = VaultIndex.build(scoped);
  const allowed = allowedPaths(index, filters);
  if (!(allowed === null || allowed instanceof Set)) {
    return { total: 0, hits: [], unknownLinkTarget: allowed.unknownLink };
  }
  const needles = parseSearchQuery(query);
  const exact = foldForSearch(query.replace(/"/g, '').trim());
  const scoredNotes = scoped
    .filter((note) => (allowed === null || allowed.has(note.path)) && isRecentEnough(note, filters))
    .map((note) => ({ note, score: scoreOf(note, needles, exact, filters.titleOnly === true) }))
    .filter(({ score }) => score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || byRecency(a.note, b.note));
  const showLines = filters.titleOnly !== true;
  const hits = scoredNotes
    .slice(0, Math.max(0, limit))
    .map(({ note }) => hitFor(index, note, showLines ? needles : []));
  return { total: scoredNotes.length, hits };
}

/** The notes the tag, folder and link filters leave (null: no such filter), or why none can match. */
function allowedPaths(
  index: VaultIndex,
  filters: SearchFilters,
): Set<VaultPath> | null | { unknownLink: string } {
  let allowed: Set<VaultPath> | null = null;
  const keep = (paths: Iterable<VaultPath>): void => {
    const next = new Set(paths);
    allowed = allowed === null ? next : new Set([...allowed].filter((path) => next.has(path)));
  };
  for (const tag of filters.tags ?? []) keep(index.notesWithTag(tagKey(tag.replace(/^#/, ''))));
  if (filters.folder !== undefined && filters.folder.replace(/^\/+|\/+$/g, '') !== '') {
    keep(index.paths().filter((path) => isInFolder(path, filters.folder as string)));
  }
  if (filters.linksTo !== undefined) {
    const target = index.resolve(filters.linksTo.replace(/^\[\[|\]\]$/g, ''));
    if (target === null) return { unknownLink: filters.linksTo };
    keep(index.backlinks(target));
  }
  return allowed;
}

/** Whether a note is in `folder` or below it; the folder's case is not minded. */
function isInFolder(path: VaultPath, folder: string): boolean {
  const wanted = foldForSearch(folder.replace(/^\/+|\/+$/g, ''));
  return foldForSearch(path).startsWith(`${wanted}/`);
}

const isRecentEnough = (note: SearchableNote, { modifiedSinceMs }: SearchFilters): boolean =>
  modifiedSinceMs === undefined || note.modifiedMs >= modifiedSinceMs;

const byRecency = (a: SearchableNote, b: SearchableNote): number =>
  b.modifiedMs - a.modifiedMs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** A note's score for the needles, or null when one of them is missing. No needles: every note scores 0. */
function scoreOf(
  note: SearchableNote,
  needles: readonly Needle[],
  exact: string,
  titleOnly: boolean,
): number | null {
  const title = foldForSearch(noteTitle(note.path));
  const bonus = exact !== '' && title === exact ? EXACT_TITLE_BONUS : 0;
  if (titleOnly) {
    return needles.every(({ folded }) => title.includes(folded))
      ? needles.length * TITLE_WEIGHT + bonus
      : null;
  }
  const body = foldForSearch(note.text);
  const headings = note.text.split('\n').filter((line) => isHeadingLine(line.trim()));
  const foldedHeadings = foldForSearch(headings.join('\n'));
  let score = bonus;
  for (const { folded } of needles) {
    const inTitle = title.includes(folded);
    const bodyHits = countUpTo(body, folded, MAX_BODY_HITS);
    if (!inTitle && bodyHits === 0) return null;
    score +=
      (inTitle ? TITLE_WEIGHT : 0) +
      (foldedHeadings.includes(folded) ? HEADING_WEIGHT : 0) +
      bodyHits;
  }
  return score;
}

/** How many times `needle` is in `text`, counting no further than `max`. */
function countUpTo(text: string, needle: string, max: number): number {
  let count = 0;
  for (
    let at = text.indexOf(needle);
    at !== -1 && count < max;
    at = text.indexOf(needle, at + needle.length)
  ) {
    count += 1;
  }
  return count;
}

function hitFor(index: VaultIndex, note: SearchableNote, needles: readonly Needle[]): SearchHit {
  const lines = matchingLines(note.text, needles, LINES_PER_HIT);
  return {
    path: note.path,
    title: noteTitle(note.path),
    tags: index.tagsOf(note.path).map(({ name }) => name),
    modifiedMs: note.modifiedMs,
    lines,
    summary: lines.length === 0 ? index.summary(note.path) : '',
  };
}
