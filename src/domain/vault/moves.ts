import type { FolderNode } from './folder-tree.ts';
import {
  fileNameOf,
  foldedPath,
  folderOf,
  isWithin,
  joinPath,
  VAULT_ROOT,
  type VaultPath,
} from './note-path.ts';

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

/** What is under the pointer as a tree row is dragged: a row, or (null) the space around them. */
export type DropPoint = VaultEntry | null;

/** The folder at `path` in `tree`, or undefined when it is not there. */
function folderNodeAt(tree: FolderNode, path: VaultPath): FolderNode | undefined {
  if (path === VAULT_ROOT) return tree;
  let node: FolderNode | undefined = tree;
  for (const part of path.split('/')) node = node?.folders.find((sub) => sub.name === part);
  return node;
}

/** Whether `folder` already holds something with `entry`'s name, case aside, as the disk sees it. */
function nameTakenIn(tree: FolderNode, folder: VaultPath, entry: VaultEntry): boolean {
  const node = folderNodeAt(tree, folder);
  if (node === undefined) return false;
  const wanted = foldedPath(fileNameOf(entry.path));
  const names = [...node.folders.map((sub) => sub.name), ...node.notes.map(fileNameOf)];
  return names.some((name) => foldedPath(name) === wanted);
}

/**
 * The folder a drag of `entry` held at `point` drops it into: a folder row
 * is that folder, a note row is the folder the note is in (a note is never a
 * target), and the space around the rows is the top of the vault (''). Null
 * when that drop may not happen: the entry is already there, a folder would
 * go inside itself, or the folder already shows something of that name.
 */
export function dropFolderAt(
  entry: VaultEntry,
  point: DropPoint,
  tree: FolderNode,
): VaultPath | null {
  const folder =
    point === null ? VAULT_ROOT : point.kind === 'folder' ? point.path : folderOf(point.path);
  if (pathMovedInto(entry, folder) === null) return null;
  return nameTakenIn(tree, folder, entry) ? null : folder;
}
