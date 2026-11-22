import { isNotePath, type VaultPath } from './note-path.ts';

/** The generated index: derived, never edited, never shown as notes. */
export const INDEX_FOLDER = '_index';

/** The app's own synced state, such as favorites. */
export const APP_FOLDER = '.dfai-lite';

/**
 * The empty file a new folder is made with, because git carries files, not
 * folders: without it an empty folder never reaches the other Mac. Hidden,
 * like every dot file, and left in place once the folder holds notes.
 */
export const KEEP_FILE = '.gitkeep';

/** Files a folder may hold and still count as empty: its keep file, and Finder's `.DS_Store`. */
const DISPOSABLE_FILES: ReadonlySet<string> = new Set([KEEP_FILE, '.DS_Store']);

/** Whether a file is one an empty folder may hold, so removing the folder loses nothing. */
export function isDisposableFile(path: VaultPath): boolean {
  return DISPOSABLE_FILES.has(path.slice(path.lastIndexOf('/') + 1));
}

/**
 * Whether a path is kept out of the tree, the index and search: anything
 * under `_index/` or `.dfai-lite/`, and any file or folder whose name starts
 * with a dot (`.github/`, `.gitignore`).
 */
export function isHiddenPath(path: VaultPath): boolean {
  if (path === INDEX_FOLDER || path.startsWith(`${INDEX_FOLDER}/`)) return true;
  return path.split('/').some((part) => part.startsWith('.'));
}

/**
 * Whether a path is part of the vault as the app reads it: not inside a dot
 * folder (git's, an editor's) other than the app's own, nor `node_modules`,
 * nor a dot file (`.DS_Store`).
 */
export function isVaultContent(path: VaultPath): boolean {
  return path
    .split('/')
    .every((part) => part === APP_FOLDER || (!part.startsWith('.') && part !== 'node_modules'));
}

/** Whether the app reads a file as text: a note, or its own JSON under `.dfai-lite/`. */
export function isTextFile(path: VaultPath): boolean {
  if (!isVaultContent(path)) return false;
  return isNotePath(path) || (path.startsWith(`${APP_FOLDER}/`) && /\.json$/i.test(path));
}

/** Whether a folder is one the tree shows: not `_index/`, not a dot folder, not packages. */
export function isVisibleFolder(path: VaultPath): boolean {
  return path !== '' && isVaultContent(path) && !isHiddenPath(path);
}

/** Whether a file is a note the app shows: markdown, and not hidden. */
export function isVisibleNote(path: VaultPath): boolean {
  return isNotePath(path) && !isHiddenPath(path);
}
