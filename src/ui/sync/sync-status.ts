/**
 * Where sync stands, as the sidebar's chip shows it. The composition root
 * turns the sync scheduler's state into this; the UI only draws it.
 */
export type SyncStatus =
  | { readonly kind: 'idle'; readonly lastSyncedAt: Date | null }
  | { readonly kind: 'syncing' }
  | { readonly kind: 'offline' }
  /** git's login to the remote was refused. */
  | { readonly kind: 'needs-sign-in' }
  /** The vault does not sync: not a git repository, or no remote. Said in `message`. */
  | { readonly kind: 'off'; readonly message: string }
  | { readonly kind: 'conflicts'; readonly count: number; readonly lastSyncedAt: Date | null }
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
}
