export { matchingLines, MAX_LINE_LENGTH, type MatchedLine } from './match-lines.ts';
export { foldForSearch, parseSearchQuery, type Needle } from './search-query.ts';
export { isSearchedPath, isSkippedRootFolder } from './search-scope.ts';
export {
  LINES_PER_HIT,
  searchNotes,
  type SearchableNote,
  type SearchFilters,
  type SearchHit,
  type SearchRequest,
  type SearchResult,
} from './search-notes.ts';
