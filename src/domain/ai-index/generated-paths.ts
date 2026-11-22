import { INDEX_ROOT } from './text.ts';

/**
 * Whether a path is one `buildAiIndex` can write: its README, the tag file,
 * and anything under `folders/` or `meetings/`. Only these may be removed
 * when the notes no longer give them; anything else under `_index/` was put
 * there by someone else and is left alone.
 */
export function isGeneratedIndexPath(path: string): boolean {
  if (path === `${INDEX_ROOT}/README.md` || path === `${INDEX_ROOT}/tags.md`) return true;
  return path.startsWith(`${INDEX_ROOT}/folders/`) || path.startsWith(`${INDEX_ROOT}/meetings/`);
}
