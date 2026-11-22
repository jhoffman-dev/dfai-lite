import { favoritesAfterDelete } from '../../domain/favorites/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { FileChangedError } from '../ports/index.ts';
import { writeFavorites } from './favorites.ts';
import { refreshPaths, type VaultDeps } from './vault-deps.ts';

/**
 * Deletes a note: to the Trash here (or for good, when the person chose that
 * after the Trash refused), and from the remote on the next sync (its
 * history keeps it). Only the text the person last saw is deleted: a note
 * changed on disk since is read afresh and kept. It leaves the favourites
 * too. Links to it are left as written, and simply stop resolving.
 */
export async function deleteNote(
  deps: VaultDeps,
  { path, permanently = false }: { path: VaultPath; permanently?: boolean },
): Promise<void> {
  const expected = deps.session.file(path)?.text ?? null;
  try {
    await deps.files.remove({ path, expected, permanently });
  } catch (error) {
    if (!(error instanceof FileChangedError)) throw error;
    await refreshPaths(deps, [path]);
    throw new FileChangedError(`${path} changed on disk since you saw it, so it was not deleted.`);
  }
  deps.session.applyDelete(path);
  await writeFavorites(deps, favoritesAfterDelete(deps.session.favorites, path));
}
