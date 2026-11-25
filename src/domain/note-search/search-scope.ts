import {
  ATTACHMENTS_FOLDER,
  INDEX_FOLDER,
  TRANSCRIPTS_FOLDER,
  isVaultGuide,
  isVisibleNote,
  type VaultPath,
} from '../vault/index.ts';

/** Folders at the vault's root a search never reads, beyond the hidden ones. */
const SKIPPED_ROOT_FOLDERS: ReadonlySet<string> = new Set([ATTACHMENTS_FOLDER]);

/**
 * Whether a search reads a note: a visible note (not `_index/`, `.dfai-lite/`,
 * `.git/` or any dot folder), not one of the vault's guides, not under
 * `attachments/`, and under `Transcripts/` only when `transcripts` is asked.
 */
export function isSearchedPath(
  path: VaultPath,
  { transcripts }: { transcripts: boolean },
): boolean {
  if (!isVisibleNote(path) || isVaultGuide(path)) return false;
  const top = path.includes('/') ? path.slice(0, path.indexOf('/')) : '';
  if (SKIPPED_ROOT_FOLDERS.has(top)) return false;
  return transcripts || top !== TRANSCRIPTS_FOLDER;
}

/** Whether a whole root folder can be left unread, so a walk of the vault never opens it. */
export function isSkippedRootFolder(
  name: string,
  { transcripts }: { transcripts: boolean },
): boolean {
  if (name.startsWith('.') || name === INDEX_FOLDER || name === 'node_modules') return true;
  if (SKIPPED_ROOT_FOLDERS.has(name)) return true;
  return !transcripts && name === TRANSCRIPTS_FOLDER;
}
