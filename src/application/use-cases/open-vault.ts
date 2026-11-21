import type { VaultDeps } from './vault-deps.ts';

export interface OpenedVault {
  /** Visible notes, as the tree and search show them. */
  readonly noteCount: number;
  /** Why the favourites file could not be read, or null. */
  readonly favoritesProblem: string | null;
}

/** Reads the whole vault from disk, in one call, into the session and builds the index. No git. */
export async function openVault(deps: VaultDeps): Promise<OpenedVault> {
  const { notes, otherPaths } = await deps.files.readAll();
  deps.session.load(notes, otherPaths);
  return {
    noteCount: deps.session.index.paths().length,
    favoritesProblem: deps.session.favoritesProblem,
  };
}
