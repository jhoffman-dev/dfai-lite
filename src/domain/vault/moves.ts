import { fileNameOf, folderOf, isWithin, joinPath, type VaultPath } from './note-path.ts';

/** A note or a folder, as the tree shows it and a move takes it. */
export interface VaultEntry {
  readonly kind: 'note' | 'folder';
  readonly path: VaultPath;
}

/**
 * Where `entry` lands when moved into `folder` (the root is ''), keeping its
 * name; null when the move would do nothing (it is already there) or cannot
 * be (a folder into itself or into a folder under it).
 */
export function pathMovedInto(entry: VaultEntry, folder: VaultPath): VaultPath | null {
  if (folderOf(entry.path) === folder) return null;
  if (entry.kind === 'folder' && folder !== '' && isWithin(folder, entry.path)) return null;
  return joinPath(folder, fileNameOf(entry.path));
}
