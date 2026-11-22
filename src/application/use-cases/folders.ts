import {
  fileNameOf,
  folderPathProblem,
  foldedPath,
  isDisposableFile,
  isVisibleNote,
  isWithin,
  joinPath,
  pathMovedInto,
  type VaultPath,
} from '../../domain/vault/index.ts';
import { FileChangedError, FileExistsError, TrashRefusedError } from '../ports/index.ts';
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
  | {
      readonly kind: 'deleted';
      readonly deleted: number;
      /** Notes the folder held. */
      readonly total: number;
      /** Notes kept because they changed on disk since they were read. */
      readonly kept: readonly VaultPath[];
      /** The Trash would not take a note: the run stopped there, the rest kept. */
      readonly trashRefused: boolean;
    }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * `path` spelled as the folders already there spell it, case aside, so a
 * folder typed `projects/Q4` lands in the existing `Projects/`, as the disk
 * would put it, and never shows as a second folder.
 */
export function spelledAsExisting(session: VaultSession, path: VaultPath): VaultPath {
  const byFold = new Map(session.folders().map((folder) => [foldedPath(folder), folder]));
  let spelled = '';
  for (const part of path.split('/')) {
    const next = joinPath(spelled, part);
    spelled = byFold.get(foldedPath(next)) ?? next;
  }
  return spelled;
}

/** Why `path` cannot be a new folder's path, or null when it can. */
export function newFolderProblem(session: VaultSession, path: VaultPath): string | null {
  const problem = folderPathProblem(path);
  if (problem !== null) return problem;
  const wanted = foldedPath(path);
  const taken = [...session.folders(), ...session.takenPaths()];
  const clash = taken.find((other) => foldedPath(other) === wanted);
  return clash === undefined ? null : `Something is already at ${clash}.`;
}

/**
 * Makes an empty folder at `path` (any missing folder above it too), in the
 * folders already there as they are spelled. It is made with a `.gitkeep`,
 * so git carries it to the other Mac while empty. Refused when the name
 * breaks the rules or anything is already there.
 */
export async function createFolder(
  deps: VaultDeps,
  { path: typed }: { path: VaultPath },
): Promise<CreateFolderResult> {
  const problem = newFolderProblem(deps.session, typed);
  if (problem !== null) return { kind: 'refused', reason: problem };
  const path = spelledAsExisting(deps.session, typed);
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
 * What in the folder the note commands cannot delete: files that are not
 * notes (an image), and dot-named files the tree hides (`.draft.md`), all
 * but the disposable `.gitkeep` and `.DS_Store`.
 */
function undeletable(session: VaultSession, path: VaultPath): VaultPath[] {
  const inside = (other: VaultPath) => isWithin(other, path) && !isDisposableFile(other);
  const others = session.otherPaths().filter(inside);
  const hidden = [...session.allFiles()]
    .map((file) => file.path)
    .filter((file) => inside(file) && !isVisibleNote(file));
  return [...others, ...hidden].sort();
}

/**
 * Deletes a folder: each note in it, at any depth, goes to the Trash one by
 * one through `deleteNote` (or for good when `permanently`), then the
 * emptied folders go. Refused, before anything is deleted, when it holds
 * what the note commands cannot delete. A note changed on disk since it was
 * read is kept and the rest go on; a Trash that refuses stops the run, so
 * the person can choose to delete the rest for good.
 */
export async function deleteFolder(
  deps: VaultDeps,
  {
    path,
    permanently = false,
    skip = [],
  }: {
    path: VaultPath;
    permanently?: boolean;
    /** Notes left alone: the ones kept on an earlier run, which must not go on a retry. */
    skip?: readonly VaultPath[];
  },
): Promise<DeleteFolderResult> {
  const { session } = deps;
  if (path === '') return { kind: 'refused', reason: 'The vault itself cannot be deleted here.' };
  const blocking = undeletable(session, path);
  if (blocking.length > 0) {
    const names = blocking.slice(0, 3).map(fileNameOf).join(', ');
    const more = blocking.length > 3 ? ` and ${blocking.length - 3} more` : '';
    return {
      kind: 'refused',
      reason: `“${fileNameOf(path)}” holds files the app does not delete (${names}${more}). Move them in Finder first.`,
    };
  }
  const notes = [...session.allFiles()]
    .map((file) => file.path)
    .filter((note) => isWithin(note, path) && !skip.includes(note))
    .sort();
  const kept: VaultPath[] = [];
  let deleted = 0;
  for (const note of notes) {
    try {
      await deleteNote(deps, { path: note, permanently });
      deleted += 1;
    } catch (error) {
      if (error instanceof TrashRefusedError) {
        return { kind: 'deleted', deleted, total: notes.length, kept, trashRefused: true };
      }
      if (!(error instanceof FileChangedError)) throw error;
      kept.push(note);
    }
  }
  await removeEmptyFolders(deps, path);
  return { kind: 'deleted', deleted, total: notes.length, kept, trashRefused: false };
}
