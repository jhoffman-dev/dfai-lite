import { pushDueIn } from '../../domain/sync/index.ts';
import type { Clock } from '../ports/index.ts';
import type { SyncNow, SyncResult } from './sync-now.ts';

/** Timers, injected so tests move time by hand (`setTimeout` in the app). */
export interface SyncTimers {
  /** Runs `run` once, `ms` from now; the returned function cancels it. */
  after(ms: number, run: () => void): () => void;
}

/**
 * What sync is doing, for the status line. `offline`: the remote could not
 * be reached. `needs-sign-in`: git's login was refused. `off`: the vault is
 * not a repository with a remote, said in `message`. `error`: anything
 * else, said in `message`. Each lasts until a sync succeeds.
 */
export type SyncPhase =
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'needs-sign-in'
  | 'off'
  /** Waiting on the person outside the app: a merge to finish in git, iCloud, a detached branch. */
  | 'blocked'
  /** Many notes are gone from the folder: waiting for the person's yes, in `deletions`. */
  | 'needs-confirmation'
  | 'error';

export interface SyncStatus {
  readonly phase: SyncPhase;
  /** Conflict copies the last successful sync made (each is a file in the vault to merge). */
  readonly conflicts: number;
  readonly lastSyncedAt: Date | null;
  /** Why the last sync failed, is off or waits; after a good one, what it left out. Null when nothing. */
  readonly message: string | null;
  /** The notes whose deletion waits for a yes (`needs-confirmation`); empty otherwise. */
  readonly deletions: readonly string[];
}

export interface SyncScheduler {
  /** Syncs now, then pulls every `pullEveryMs`. */
  start(): Promise<void>;
  /** Cancels every timer. A sync already running finishes. */
  stop(): void;
  /**
   * The vault changed: push `pushDelayMs` after the last such call, and no
   * later than `maxUnsyncedMs` after the first one since a sync began.
   */
  noteChanged(): void;
  /** Sync now: the app came back online, or into view. */
  wake(): Promise<void>;
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
}

export interface SyncSchedulerDeps {
  readonly syncNow: SyncNow;
  readonly timers: SyncTimers;
  readonly clock: Clock;
  readonly pushDelayMs: number;
  readonly pullEveryMs: number;
  /** Changes that keep coming are pushed at least this often (DFAI: five minutes). */
  readonly maxUnsyncedMs?: number;
  /** A sync that has not finished by then is given up on, so it cannot hold up the next forever. */
  readonly watchdogMs?: number;
  /**
   * Where an error thrown by a status listener goes, so one broken listener
   * cannot stop sync. Rethrown on its own (to the global error handler) by default.
   */
  readonly onListenerError?: (error: unknown) => void;
}

const rethrowApart = (error: unknown) =>
  queueMicrotask(() => {
    throw error;
  });

const NOT_YET: SyncStatus = {
  phase: 'idle',
  conflicts: 0,
  lastSyncedAt: null,
  message: null,
  deletions: [],
};

/** Longer than every git step's own limit together; only a sync that hangs reaches it. */
export const SYNC_WATCHDOG_MS = 15 * 60_000;

/**
 * When to sync: soon after typing stops, on an interval, and when woken.
 * Never two at once: a request while one runs is folded into one more run
 * after it.
 */
export function createSyncScheduler(deps: SyncSchedulerDeps): SyncScheduler {
  const listeners = new Set<(status: SyncStatus) => void>();
  let current = NOT_YET;
  let started = false;
  let stopped = false;
  let running: Promise<void> | null = null;
  let again = false;
  let cancelPush: (() => void) | null = null;
  let cancelPull: (() => void) | null = null;
  let firstUnsyncedAt: number | null = null;

  const publish = (next: SyncStatus) => {
    current = next;
    for (const listener of listeners) {
      try {
        listener(current);
      } catch (error) {
        (deps.onListenerError ?? rethrowApart)(error);
      }
    }
  };

  const armPull = () => {
    cancelPull?.();
    cancelPull = started ? deps.timers.after(deps.pullEveryMs, () => void sync()) : null;
  };

  const runOnce = async () => {
    // This sync takes every change so far; a change from here on waits its own turn.
    firstUnsyncedAt = null;
    publish({ ...current, phase: 'syncing' });
    const watchdogMs = deps.watchdogMs ?? SYNC_WATCHDOG_MS;
    publish(statusAfter(current, await settled(deps.syncNow, deps.timers, watchdogMs), deps.clock));
  };

  const sync = (): Promise<void> => {
    if (running !== null) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await runOnce();
        } while (again);
      } finally {
        running = null;
        armPull();
      }
    })();
    return running;
  };

  return {
    start() {
      started = true;
      stopped = false;
      return sync();
    },
    stop() {
      started = false;
      stopped = true;
      cancelPush?.();
      cancelPull?.();
      cancelPush = cancelPull = null;
    },
    noteChanged() {
      if (stopped) return;
      cancelPush?.();
      const now = deps.clock.now().getTime();
      const dueIn = pushDueIn({
        now,
        firstUnsyncedAt,
        pushDelayMs: deps.pushDelayMs,
        ...(deps.maxUnsyncedMs === undefined ? {} : { maxUnsyncedMs: deps.maxUnsyncedMs }),
      });
      firstUnsyncedAt ??= now;
      cancelPush = deps.timers.after(dueIn, () => {
        cancelPush = null;
        void sync();
      });
    },
    wake: () => sync(),
    status: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The sync's result; a sync that throws (a bug) or never finishes is a
 * failed one, so the scheduler keeps going.
 */
async function settled(
  syncNow: SyncNow,
  timers: SyncTimers,
  watchdogMs: number,
): Promise<SyncResult> {
  let cancel: () => void = () => undefined;
  const givenUp = new Promise<SyncResult>((resolve) => {
    cancel = timers.after(watchdogMs, () =>
      resolve({
        kind: 'failed',
        reason: 'error',
        message: 'Sync did not finish and was given up on; it will try again.',
      }),
    );
  });
  try {
    return await Promise.race([syncNow(), givenUp]);
  } catch (error) {
    return {
      kind: 'failed',
      reason: 'error',
      message: error instanceof Error ? error.message : 'Sync failed.',
    };
  } finally {
    cancel();
  }
}

const PHASES = {
  auth: 'needs-sign-in',
  unreachable: 'offline',
  // The remote kept moving: the next sync tries again, and nothing is wrong meanwhile.
  rejected: 'idle',
  locked: 'error',
  error: 'error',
} as const;

function statusAfter(before: SyncStatus, result: SyncResult, clock: Clock): SyncStatus {
  if (result.kind === 'synced')
    return {
      phase: 'idle',
      conflicts: result.conflicts.length,
      lastSyncedAt: clock.now(),
      message: result.warnings.length === 0 ? null : result.warnings.join(' '),
      deletions: [],
    };
  const waiting = { ...before, message: result.message, deletions: [] };
  if (result.kind === 'off') return { ...waiting, phase: 'off' };
  if (result.kind === 'blocked') return { ...waiting, phase: 'blocked' };
  if (result.kind === 'needs-confirmation') {
    return { ...waiting, phase: 'needs-confirmation', deletions: result.deletions };
  }
  return { ...waiting, phase: PHASES[result.reason] };
}
