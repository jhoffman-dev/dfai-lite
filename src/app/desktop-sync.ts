import {
  createDeletionApprovals,
  createSyncNow,
  createSyncScheduler,
  type GitPort,
  type SyncNow,
  type VaultDeps,
  type WriteGate,
} from '../application/index.ts';
import { systemClock, systemTimers } from '../adapters/clock/index.ts';
import { buildAiIndex } from '../domain/ai-index/index.ts';
import { parseGitStatus, PULL_EVERY_MS, PUSH_DELAY_MS } from '../domain/sync/index.ts';
import type { RemoteInfo } from '../ui/settings/desktop-controls.ts';
import type { SyncControls } from '../ui/sync/sync-status.ts';
import { connectSync } from './sync-controls.ts';

/** The window's `online` and `visibilitychange`, for the scheduler's wake-ups. */
const windowPage = {
  addEventListener(type: string, listener: () => void) {
    (type === 'visibilitychange' ? document : window).addEventListener(type, listener);
  },
  isVisible: () => document.visibilityState === 'visible',
};

/**
 * Sync over the Mac's own git, on DFAI's schedule. This Mac's name is asked
 * for on the first sync, not at start, so the window never waits on it.
 */
export function wireSync({
  deps,
  git,
  gate,
  flush,
}: {
  /** The vault's files as sync uses them: not behind `gate`, which sync holds. */
  deps: VaultDeps;
  git: GitPort;
  gate: WriteGate;
  flush: () => Promise<void>;
}): SyncControls & { start(): void } {
  const approvals = createDeletionApprovals();
  let syncNow: Promise<SyncNow> | null = null;
  const firstSyncNow = async () =>
    createSyncNow({
      ...deps,
      ...{ git, gate, approvals, flush },
      mac: await git.macName(),
      derivedFiles: buildAiIndex,
    });
  const scheduler = createSyncScheduler({
    syncNow: async () => (await (syncNow ??= firstSyncNow()))(),
    timers: systemTimers,
    clock: systemClock,
    pushDelayMs: PUSH_DELAY_MS,
    pullEveryMs: PULL_EVERY_MS,
  });
  return connectSync({ scheduler, session: deps.session, page: windowPage, approvals });
}

/** Where the vault syncs: the remote's address and the upstream branch; null when there is none. */
export async function remoteInfo(git: GitPort): Promise<RemoteInfo | null> {
  const [url, status] = await Promise.all([
    git.run({ kind: 'remoteUrl' }),
    git.run({ kind: 'status' }),
  ]);
  if (url.code !== 0 || status.code !== 0) return null;
  const { upstream } = parseGitStatus(status.stdout);
  return upstream === null ? null : { url: url.stdout.trim(), branch: upstream };
}
