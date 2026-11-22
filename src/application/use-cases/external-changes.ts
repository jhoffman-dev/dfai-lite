import { isImagePath } from '../../domain/attachments/index.ts';
import { isTextFile, isVaultContent, type VaultPath } from '../../domain/vault/index.ts';
import { refreshPaths, type VaultDeps } from './vault-deps.ts';

/** Past this many changed files at once (a big pull), the vault is read whole instead. */
const READ_WHOLE_PAST = 100;

/**
 * Brings the session in step with files changed on disk by someone else:
 * Claude Code, git, another editor. Each text file is read afresh, and each
 * picture is looked for, so a pasted image never reads the whole vault; a
 * change the watcher names by folder (a folder moved) or to any other file,
 * or a great many changes, reads the whole vault. Files the app just wrote
 * itself read back the same, and change nothing. Returns the paths that
 * changed in the session.
 */
export async function applyExternalChanges(
  deps: VaultDeps,
  paths: readonly VaultPath[],
): Promise<VaultPath[]> {
  const relevant = paths.filter(isVaultContent);
  if (relevant.length === 0) return [];
  const pictures = relevant.filter((path) => !isTextFile(path) && isImagePath(path));
  const texts = relevant.filter(isTextFile);
  const known = texts.length + pictures.length === relevant.length;
  if (relevant.length > READ_WHOLE_PAST || !known) return reloadVault(deps);
  const found = await refreshPictures(deps, pictures);
  if (found === null) return reloadVault(deps);
  return [...(await refreshPaths(deps, texts)), ...found];
}

/**
 * Each picture looked for on disk and listed, or no longer, in the session;
 * null when one cannot be read as a file (a folder named like a picture),
 * so the caller reads the vault whole instead.
 */
async function refreshPictures(
  { files, session }: VaultDeps,
  paths: readonly VaultPath[],
): Promise<VaultPath[] | null> {
  for (const path of new Set(paths)) {
    try {
      session.applyOtherFile(path, (await files.readBinary(path)) !== null);
    } catch {
      // Not a file the host reads (a folder, or one past its ceiling): a whole read settles it.
      return null;
    }
  }
  return [...new Set(paths)];
}

/**
 * Reads the whole vault and brings the session in step with it: each file
 * that differs is written or dropped one by one, so an open note's listeners
 * hear only their own change; a great many differences load afresh.
 */
export async function reloadVault(deps: VaultDeps): Promise<VaultPath[]> {
  const { files, session } = deps;
  const { notes, otherPaths, folders } = await files.readAll();
  const onDisk = new Map(notes.map((file) => [file.path, file.text]));
  const changed = notes
    .filter((file) => session.file(file.path)?.text !== file.text)
    .map((file) => file.path);
  for (const file of session.allFiles()) if (!onDisk.has(file.path)) changed.push(file.path);
  const othersMoved = otherPaths.join('\0') !== session.otherPaths().join('\0');
  const foldersMoved = folders.join('\0') !== [...session.folders()].sort().join('\0');
  if (changed.length > READ_WHOLE_PAST || othersMoved || foldersMoved) {
    session.load(notes, otherPaths, folders);
    return changed;
  }
  for (const path of changed) {
    const text = onDisk.get(path);
    if (text === undefined) session.applyDelete(path);
    else session.applyWrite({ path, text });
  }
  return changed;
}
