import { describe, expect, it } from 'vitest';
import type { SyncControls, SyncStatus } from '../ui/sync/sync-status.ts';
import { syncReadiness } from './desktop-granola.ts';

/** Sync's status, set by hand. */
function controls(first: SyncStatus) {
  let status = first;
  const listeners = new Set<() => void>();
  const sync: SyncControls = {
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncNow: () => undefined,
    confirmDeletions: () => undefined,
  };
  const set = (next: SyncStatus) => {
    status = next;
    for (const listener of listeners) listener();
  };
  return { sync, set };
}

const AT = new Date('2026-11-22T09:00:00Z');

/** Every status sync can show before a sync has finished in this session. */
const BEFORE_A_PULL: readonly SyncStatus[] = [
  { kind: 'idle', lastSyncedAt: null },
  { kind: 'syncing' },
  { kind: 'offline' },
  { kind: 'needs-sign-in' },
  // Conflict copies left from an earlier session are counted as the app opens.
  { kind: 'conflicts', count: 2, lastSyncedAt: null },
  { kind: 'blocked', message: 'A merge is in progress.' },
  { kind: 'needs-confirmation', count: 30, examples: [], message: 'Many notes are gone.' },
  { kind: 'error', message: 'git failed' },
];

describe('whether Granola may import: a sync has pulled the vault this session', () => {
  it.each(BEFORE_A_PULL)('not before a pull, while sync shows $kind', (status) => {
    const { sync } = controls(status);
    expect(syncReadiness(sync).isReady()).toBe(false);
  });

  it('once a sync finishes, with or without conflict copies, and it stays so', () => {
    for (const done of [
      { kind: 'idle', lastSyncedAt: AT },
      { kind: 'conflicts', count: 1, lastSyncedAt: AT },
    ] as const) {
      const { sync, set } = controls({ kind: 'conflicts', count: 2, lastSyncedAt: null });
      const readiness = syncReadiness(sync);
      let heard = 0;
      readiness.subscribe(() => (heard += 1));
      set({ kind: 'syncing' });
      expect(readiness.isReady()).toBe(false);
      set(done);
      expect(readiness.isReady()).toBe(true);
      set({ kind: 'offline' });
      expect(readiness.isReady()).toBe(true);
      expect(heard).toBe(1);
    }
  });

  it('at once for a vault that does not sync: there is nothing to pull', () => {
    const { sync } = controls({ kind: 'off', message: 'Not a git repository.' });
    expect(syncReadiness(sync).isReady()).toBe(true);
  });
});
