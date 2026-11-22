// The application's public entry: what the UI and the composition root use.
export * from './ports/index.ts';
export * from './session/index.ts';
export * from './use-cases/index.ts';
export * from './sync/index.ts';

// Pure readings of the vault's rules that a view needs to draw (the editor's
// links and tags, the link picker, the tree rows). The UI may import domain
// types only, so the functions it calls come through here.
export {
  formatWikiLink,
  openLinkInText,
  rankNoteSuggestions,
  splitWikiLinks,
  wikiLinkLabel,
  wikiLinkSpans,
} from '../domain/links/index.ts';
export { findTags, rankTagSuggestions, tagHue, tagKey } from '../domain/tags/index.ts';
export {
  flattenFolderTree,
  noteTitle,
  folderOf,
  foldersAbove,
  joinPath,
  pathAfterMove,
  pathMovedInto,
  dropFolderAt,
  isWithin,
  KEEP_FILE,
} from '../domain/vault/index.ts';
export { isConflictCopyPath } from '../domain/sync/index.ts';
export {
  calloutLabel,
  fitsInTableCell,
  resizedImageWidth,
  TABLE_CELL_TYPES,
} from '../domain/markdown/index.ts';
export { IMAGE_PICKER_ACCEPT } from '../domain/attachments/index.ts';
export { FAVORITES_PATH } from '../domain/favorites/index.ts';
