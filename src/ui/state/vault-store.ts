import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ResolvedAppearances, VaultSession } from '../../application/index.ts';
import type { Favorites } from '../../domain/favorites/index.ts';
import type { CalloutSettings } from '../../domain/callouts/index.ts';
import type { FolderNode, VaultPath } from '../../domain/vault/index.ts';
import { useApp } from '../services.ts';

/**
 * The session as components read it. Each field keeps its identity until
 * what it holds changes (the tree only when the set of paths does), so a
 * component selecting `tree` does not re-render when a note's text is saved.
 */
export interface VaultSnapshot {
  /** Grows with every change: select it to re-read something derived (backlinks, tags). */
  readonly version: number;
  readonly tree: FolderNode;
  readonly favorites: Favorites;
  /** Each folder's and note's look as drawn, by path; replaced only when the appearance file changes. */
  readonly appearances: ResolvedAppearances;
  /** The vault's callout types: the same object until the callouts file changes. */
  readonly callouts: CalloutSettings;
  /** Why the callouts file could not be read, or null. */
  readonly calloutsProblem: string | null;
  /** Conflict copies of the callouts file whose types are merged in. */
  readonly calloutCopies: readonly VaultPath[];
}

export type VaultStore = StoreApi<VaultSnapshot> & {
  /** Starts following the session; returns the way to stop. */
  readonly connect: () => () => void;
};

function snapshotOf(session: VaultSession): VaultSnapshot {
  return {
    version: session.version,
    tree: session.folderTree(),
    favorites: session.favorites,
    appearances: session.resolvedAppearances,
    callouts: session.calloutSettings,
    calloutsProblem: session.calloutsProblem,
    calloutCopies: session.calloutCopies,
  };
}

/** A store that follows the session's change events once connected. */
export function createVaultStore(session: VaultSession): VaultStore {
  const store = createStore<VaultSnapshot>(() => snapshotOf(session));
  const refresh = () => store.setState(snapshotOf(session));
  const connect = () => {
    refresh(); // anything that changed before the store was listening
    return session.subscribe(refresh);
  };
  return { ...store, connect };
}

export function useVault<T>(select: (snapshot: VaultSnapshot) => T): T {
  return useStore(useApp().vault, select);
}
