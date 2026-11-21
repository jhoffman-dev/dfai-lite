/**
 * Where sync stands, as the sidebar's chip shows it. The composition root
 * turns the sync scheduler's state into this; the UI only draws it.
 */
export type SyncStatus =
  /** `notice`: what the last sync left out (a file too large, a nested repository), when anything. */
  | { readonly kind: 'idle'; readonly lastSyncedAt: Date | null; readonly notice?: string }
  | { readonly kind: 'syncing' }
  | { readonly kind: 'offline' }
  /** git's login to the remote was refused. */
  | { readonly kind: 'needs-sign-in' }
  /** The vault does not sync: not a git repository, or no remote. Said in `message`. */
  | { readonly kind: 'off'; readonly message: string }
  | { readonly kind: 'conflicts'; readonly count: number; readonly lastSyncedAt: Date | null }
  /** Sync waits on something to do outside the app (finish a merge in git, iCloud): said in `message`. */
  | { readonly kind: 'blocked'; readonly message: string }
  /** Many notes are gone from the folder; sync waits for a yes before it deletes them everywhere. */
  | {
      readonly kind: 'needs-confirmation';
      readonly count: number;
      readonly examples: readonly string[];
      readonly message: string;
    }
  /** Sync stopped for another reason: said in `message`. */
  | { readonly kind: 'error'; readonly message: string };

/**
 * What the UI needs from sync: the status now, a way to hear it change, and
 * a button's worth of "sync now". Null in `AppServices` in a browser.
 */
export interface SyncControls {
  /** The same object until the status changes, as `useSyncExternalStore` needs. */
  getStatus(): SyncStatus;
  subscribe(listener: () => void): () => void;
  /** Starts a sync now; the status reports how it goes. */
  syncNow(): void;
  /** Says yes to the deletions a `needs-confirmation` status names, and syncs them. */
  confirmDeletions(): void;
}
