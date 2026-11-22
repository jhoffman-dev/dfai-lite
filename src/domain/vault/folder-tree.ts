import { ATTACHMENTS_FOLDER, INBOX_FOLDER } from './new-note.ts';
import { fileNameOf, joinPath, noteTitle, VAULT_ROOT, type VaultPath } from './note-path.ts';
import { isVisibleFolder, isVisibleNote } from './visibility.ts';

/** A folder in the tree, with what is directly in it, each list in display order. */
export interface FolderNode {
  readonly path: VaultPath;
  /** The folder's own name; empty for the root. */
  readonly name: string;
  readonly folders: readonly FolderNode[];
  readonly notes: readonly VaultPath[];
  /** Notes in it and in every folder under it. */
  readonly noteCount: number;
}

/** One visible row of the tree, flattened for a virtualized list. */
export type TreeRow =
  | {
      readonly kind: 'folder';
      readonly path: VaultPath;
      readonly name: string;
      readonly depth: number;
      readonly expanded: boolean;
      readonly noteCount: number;
    }
  | {
      readonly kind: 'note';
      readonly path: VaultPath;
      readonly name: string;
      readonly depth: number;
    };

/** Names as Finder orders them: case aside, and `Note 2` before `Note 10`. */
const NAMES = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Orders two names for display, falling back to code order so the order is total. */
export function compareNames(left: string, right: string): number {
  return NAMES.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}

/**
 * Orders two folders for display: by name, but the Inbox, at the top level,
 * comes first, because it is where new notes land and are filed from; and
 * `attachments`, where pasted pictures pile up, comes last, as in DFAI, so
 * it is there when wanted and out of the way when not.
 */
function compareFolders(left: FolderNode, right: FolderNode): number {
  return rankOf(left.path) - rankOf(right.path) || compareNames(left.name, right.name);
}

function rankOf(path: VaultPath): number {
  const lower = path.toLowerCase();
  if (lower === INBOX_FOLDER.toLowerCase()) return -1;
  return lower === ATTACHMENTS_FOLDER ? 1 : 0;
}

interface Building {
  path: VaultPath;
  folders: Map<string, Building>;
  notes: VaultPath[];
}

/**
 * The folder tree of the vault: its notes, and its `folders` as the disk
 * lists them, so a folder with no note in it yet is shown too. Hidden paths
 * and files that are not notes are left out.
 */
export function buildFolderTree(
  paths: Iterable<VaultPath>,
  folders: Iterable<VaultPath> = [],
): FolderNode {
  const root: Building = { path: VAULT_ROOT, folders: new Map(), notes: [] };
  for (const folder of folders) {
    if (isVisibleFolder(folder)) folderAt(root, folder.split('/'));
  }
  for (const path of paths) {
    if (isVisibleNote(path)) folderAt(root, path.split('/').slice(0, -1)).notes.push(path);
  }
  return finish(root);
}

/** The folder at `parts` under `root`, made on the way down where missing. */
function folderAt(root: Building, parts: readonly string[]): Building {
  let folder = root;
  for (const part of parts) {
    let next = folder.folders.get(part);
    if (next === undefined) {
      next = { path: joinPath(folder.path, part), folders: new Map(), notes: [] };
      folder.folders.set(part, next);
    }
    folder = next;
  }
  return folder;
}

function finish(folder: Building): FolderNode {
  const folders = [...folder.folders.values()].map(finish).sort(compareFolders);
  const notes = [...folder.notes].sort((left, right) =>
    compareNames(noteTitle(left), noteTitle(right)),
  );
  const noteCount = notes.length + folders.reduce((sum, child) => sum + child.noteCount, 0);
  return { path: folder.path, name: fileNameOf(folder.path), folders, notes, noteCount };
}

/**
 * The rows a tree shows: folders before notes at each level, and only the
 * contents of expanded folders, so the cost follows what is on screen.
 */
export function flattenFolderTree(root: FolderNode, expanded: ReadonlySet<VaultPath>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (folder: FolderNode, depth: number): void => {
    for (const child of folder.folders) {
      const open = expanded.has(child.path);
      rows.push({
        kind: 'folder',
        path: child.path,
        name: child.name,
        depth,
        expanded: open,
        noteCount: child.noteCount,
      });
      if (open) walk(child, depth + 1);
    }
    for (const path of folder.notes)
      rows.push({ kind: 'note', path, name: noteTitle(path), depth });
  };
  walk(root, 0);
  return rows;
}
