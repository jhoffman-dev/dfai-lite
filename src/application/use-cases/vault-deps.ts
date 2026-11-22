import type { VaultPath } from '../../domain/vault/index.ts';
import type { StoredFile, VaultFiles } from '../ports/index.ts';
import type { VaultSession } from '../session/index.ts';

/** What every vault use-case needs: the vault's files on disk, and the open session. */
export interface VaultDeps {
  readonly files: VaultFiles;
  readonly session: VaultSession;
}

/**
 * Keeps `text` at `path`: on disk first, then shown. The disk write is
 * guarded by the text the session holds, so a file changed on disk since
 * (by git, Claude, another editor) is never written over: that rejects with
 * `FileChangedError`. Returns the file as kept.
 */
export async function writeFile(
  { files, session }: VaultDeps,
  path: VaultPath,
  text: string,
): Promise<StoredFile> {
  const file: StoredFile = { path, text };
  await files.write({ path, text, expected: session.file(path)?.text ?? null });
  session.applyWrite(file);
  return file;
}

/**
 * Brings the session in step with the disk for these paths: a file changed
 * there is read afresh, one gone is dropped. Returns the paths that changed.
 */
export async function refreshPaths(
  { files, session }: VaultDeps,
  paths: Iterable<VaultPath>,
): Promise<VaultPath[]> {
  const changed: VaultPath[] = [];
  for (const path of new Set(paths)) {
    const text = await files.read(path);
    const held = session.file(path);
    if (text === null && held !== null) session.applyDelete(path);
    else if (text !== null && text !== held?.text) session.applyWrite({ path, text });
    else continue;
    changed.push(path);
  }
  return changed;
}
