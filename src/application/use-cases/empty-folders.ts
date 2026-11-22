import { isDisposableFile, isWithin, type VaultPath } from '../../domain/vault/index.ts';
import type { VaultSession } from '../session/index.ts';
import type { VaultDeps } from './vault-deps.ts';

/** Whether the folder holds nothing but disposable files: no note, no other file, no folder. */
export function isEmptyFolder(session: VaultSession, path: VaultPath): boolean {
  const inside = (other: VaultPath) => other !== path && isWithin(other, path);
  if ([...session.allFiles()].some((file) => inside(file.path))) return false;
  if (session.otherPaths().some((other) => inside(other) && !isDisposableFile(other))) {
    return false;
  }
  return !session.folders().some(inside);
}

/** The folders at and under `path`, deepest first: the order they can be removed in. */
function foldersDeepestFirst(session: VaultSession, path: VaultPath): VaultPath[] {
  return session
    .folders()
    .filter((folder) => isWithin(folder, path))
    .sort((left, right) => right.split('/').length - left.split('/').length);
}

/** Removes the folders at and under `path` that are empty, deepest first. */
export async function removeEmptyFolders(deps: VaultDeps, path: VaultPath): Promise<void> {
  for (const folder of foldersDeepestFirst(deps.session, path)) {
    if (!isEmptyFolder(deps.session, folder)) continue;
    await deps.files.removeFolder(folder);
    deps.session.applyRemoveFolder(folder);
  }
}
