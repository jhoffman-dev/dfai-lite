import {
  fileNameOf,
  folderNameProblem,
  foldedPath,
  INDEX_FOLDER,
  isDisposableFile,
  isWithin,
  pathMovedInto,
  type VaultPath,
} from '../../domain/vault/index.ts';
import { FileExistsError } from '../ports/index.ts';
import type { VaultSession } from '../session/index.ts';
import { deleteNote } from './delete-note.ts';
import { removeEmptyFolders } from './empty-folders.ts';
import { renameFolder, type RenameFolderResult } from './rename-folder.ts';
import { renameNote, type RenameResult } from './rename-note.ts';
import type { VaultDeps } from './vault-deps.ts';

export type CreateFolderResult =
  | { readonly kind: 'created'; readonly path: VaultPath }
  | { readonly kind: 'refused'; readonly reason: string };

export type DeleteFolderResult =
  | { readonly kind: 'deleted'; readonly notes: number }
  | { readonly kind: 'refused'; readonly reason: string };

/** Why `path` cannot be a new folder's path, or null when it can. */
export function newFolderProblem(session: VaultSession, path: VaultPath): string | null {
  if (path === '') return 'Give the folder a name.';
  for (const part of path.split('/')) {
    const problem = folderNameProblem(part);
    if (problem !== null) return problem;
  }
  if (foldedPath(path.split('/')[0] ?? '') === foldedPath(INDEX_FOLDER)) {
    return `${INDEX_FOLDER} is kept for the generated index.`;
  }
  const wanted = foldedPath(path);
  const taken = [...session.folders(), ...session.takenPaths()];
  const clash = taken.find((other) => foldedPath(other) === wanted);
  return clash === undefined ? null : `Something is already at ${clash}.`;
}

/**
 * Makes an empty folder at `path` (any missing folder above it too). It is
 * made with a `.gitkeep`, so git carries it to the other Mac while empty.
 * Refused when the name breaks the rules or anything is already there.
 */
export async function createFolder(
  deps: VaultDeps,
  { path }: { path: VaultPath },
): Promise<CreateFolderResult> {
  const problem = newFolderProblem(deps.session, path);
  if (problem !== null) return { kind: 'refused', reason: problem };
  try {
    await deps.files.createFolder(path);
  } catch (error) {
    if (error instanceof FileExistsError) return { kind: 'refused', reason: error.message };
    throw error;
  }
  deps.session.applyCreateFolder(path);
  return { kind: 'created', path };
}

/**
 * Moves a note into `folder` under its own name, through `renameNote`, so
 * links to it and favorites follow. Already there: nothing to do.
 */
export function moveNoteInto(
  deps: VaultDeps,
  { path, folder }: { path: VaultPath; folder: VaultPath },
): Promise<RenameResult> {
  const to = pathMovedInto({ kind: 'note', path }, folder);
  if (to === null) return Promise.resolve({ kind: 'renamed', path, retargeted: 0 });
  return renameNote(deps, { from: path, to });
}

/** Moves a folder into another (the root is ''), through `renameFolder`. */
export async function moveFolderInto(
  deps: VaultDeps,
  { path, folder }: { path: VaultPath; folder: VaultPath },
): Promise<RenameFolderResult> {
  const to = pathMovedInto({ kind: 'folder', path }, folder);
  if (to !== null) return renameFolder(deps, { from: path, to });
  return isWithin(folder, path) && folder !== ''
    ? { kind: 'refused', reason: 'A folder cannot move inside itself.' }
    : { kind: 'renamed', moved: 0, retargeted: 0 };
}

/**
 * Deletes a folder: each note in it, at any depth, goes to the Trash one by
 * one through `deleteNote` (or for good when `permanently`), then the
 * emptied folders go. Refused, before anything is deleted, when it holds
 * files that are not notes (an image): those are Finder's to move.
 */
export async function deleteFolder(
  deps: VaultDeps,
  { path, permanently = false }: { path: VaultPath; permanently?: boolean },
): Promise<DeleteFolderResult> {
  const { session } = deps;
  if (path === '') return { kind: 'refused', reason: 'The vault itself cannot be deleted here.' };
  const kept = session.otherPaths().filter((other) => isWithin(other, path));
  const blocking = kept.filter((other) => !isDisposableFile(other));
  if (blocking.length > 0) {
    const names = blocking.slice(0, 3).map(fileNameOf).join(', ');
    return {
      kind: 'refused',
      reason: `“${fileNameOf(path)}” holds files that are not notes (${names}). Move them in Finder first.`,
    };
  }
  const notes = [...session.allFiles()]
    .map((file) => file.path)
    .filter((note) => isWithin(note, path))
    .sort();
  for (const note of notes) await deleteNote(deps, { path: note, permanently });
  await removeEmptyFolders(deps, path);
  return { kind: 'deleted', notes: notes.length };
}
