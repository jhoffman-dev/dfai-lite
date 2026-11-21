import { isTextFile, isVaultContent, type VaultPath } from '../../domain/vault/index.ts';
import { refreshPaths, type VaultDeps } from './vault-deps.ts';

/** Past this many changed files at once (a big pull), the vault is read whole instead. */
const READ_WHOLE_PAST = 100;

/**
 * Brings the session in step with files changed on disk by someone else:
 * Claude Code, git, another editor. Each text file is read afresh; a change
 * the watcher names by folder (a folder moved) or to a file that is not
 * text, or a great many changes, reads the whole vault. Files the app just
 * wrote itself read back the same, and change nothing. Returns the paths
 * that changed in the session.
 */
export async function applyExternalChanges(
  deps: VaultDeps,
  paths: readonly VaultPath[],
): Promise<VaultPath[]> {
  const relevant = paths.filter(isVaultContent);
  if (relevant.length === 0) return [];
  if (relevant.length > READ_WHOLE_PAST || !relevant.every(isTextFile)) {
    return reloadVault(deps);
  }
  return refreshPaths(deps, relevant);
}

/**
 * Reads the whole vault and brings the session in step with it: each file
 * that differs is written or dropped one by one, so an open note's listeners
 * hear only their own change; a great many differences load afresh.
 */
export async function reloadVault(deps: VaultDeps): Promise<VaultPath[]> {
  const { files, session } = deps;
  const { notes, otherPaths } = await files.readAll();
  const onDisk = new Map(notes.map((file) => [file.path, file.text]));
  const changed = notes
    .filter((file) => session.file(file.path)?.text !== file.text)
    .map((file) => file.path);
  for (const file of session.allFiles()) if (!onDisk.has(file.path)) changed.push(file.path);
  const othersMoved = otherPaths.join('\0') !== session.otherPaths().join('\0');
  if (changed.length > READ_WHOLE_PAST || othersMoved) {
    session.load(notes, otherPaths);
    return changed;
  }
  for (const path of changed) {
    const text = onDisk.get(path);
    if (text === undefined) session.applyDelete(path);
    else session.applyWrite({ path, text });
  }
  return changed;
}
