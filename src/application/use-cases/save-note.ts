import { editConflictCopyPath, isoDate } from '../../domain/sync/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { FileChangedError, type Clock } from '../ports/index.ts';
import { refreshPaths, writeFile, type VaultDeps } from './vault-deps.ts';

/**
 * One save of a note's text. With `basedOnText` (the text the editor loaded
 * or last saved) the save can tell when the note changed underneath the
 * editor (a sync, Claude, another editor); `clock` then dates the copy the
 * editor's text goes to.
 */
export type SaveNoteRequest =
  | { readonly path: VaultPath; readonly text: string; readonly basedOnText?: undefined }
  | {
      readonly path: VaultPath;
      readonly text: string;
      readonly basedOnText: string;
      readonly clock: Clock;
    };

export type SaveNoteResult =
  | { readonly kind: 'saved'; readonly path: VaultPath }
  /** The note changed underneath: it was kept as it is, and the editor's text went to `path`. */
  | { readonly kind: 'forked'; readonly path: VaultPath; readonly keptPath: VaultPath };

/**
 * Keeps a note's new text on disk and reads it into the index (that note
 * only). Text that is already there changes nothing. The caller debounces
 * typing; this is one save.
 *
 * If the note's text is neither what the editor started from nor what it
 * saves now, someone else's edit arrived meanwhile: writing over it would
 * lose that edit, so the editor's text is saved as a conflict copy beside it
 * instead. The same holds when the disk changed and the session has not
 * heard yet: the write is refused, the note is read afresh, and the edit forks.
 */
export async function saveNoteText(
  deps: VaultDeps,
  request: SaveNoteRequest,
): Promise<SaveNoteResult> {
  const { path, text } = request;
  const stored = deps.session.file(path)?.text;
  if (stored === text) return { kind: 'saved', path };
  if (request.basedOnText !== undefined && stored !== undefined && stored !== request.basedOnText) {
    return fork(deps, request);
  }
  try {
    await writeFile(deps, path, text);
  } catch (error) {
    if (!(error instanceof FileChangedError) || request.basedOnText === undefined) throw error;
    await refreshPaths(deps, [path]);
    return fork(deps, request);
  }
  return { kind: 'saved', path };
}

async function fork(
  deps: VaultDeps,
  { path, text, clock }: { path: VaultPath; text: string; clock: Clock },
): Promise<SaveNoteResult> {
  const copy = editConflictCopyPath({
    path,
    date: isoDate(clock.now()),
    taken: deps.session.takenPaths(),
  });
  await writeFile(deps, copy, text);
  return { kind: 'forked', path: copy, keptPath: path };
}
