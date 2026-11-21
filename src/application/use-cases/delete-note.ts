import { favoritesAfterDelete } from '../../domain/favorites/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { writeFavorites } from './favorites.ts';
import type { VaultDeps } from './vault-deps.ts';

/**
 * Deletes a note: to the Trash here, and from the remote on the next sync
 * (its history keeps it). It leaves the favourites too. Links to it are left
 * as written, and simply stop resolving.
 */
export async function deleteNote(deps: VaultDeps, { path }: { path: VaultPath }): Promise<void> {
  await deps.files.remove(path);
  deps.session.applyDelete(path);
  await writeFavorites(deps, favoritesAfterDelete(deps.session.favorites, path));
}
