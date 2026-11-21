import {
  mergeCommitMessage,
  syncCommitMessage,
  type GitConflict,
  type GitStatus,
} from '../../domain/sync/index.ts';
import { FileChangedError, type GitPort, type VaultFiles } from '../ports/index.ts';
import type { VaultSession } from '../session/index.ts';
import { reloadVault } from '../use-cases/index.ts';
import { GitStepError, mergeInProgress, readStatus, runOk } from './git-steps.ts';
import { settleConflicts, type SyncConflict } from './settle-conflicts.ts';
import { writeIndexFiles, type DerivedFiles } from './write-index.ts';

/** What sync needs. */
export interface SyncDeps {
  readonly git: GitPort;
  readonly files: VaultFiles;
  readonly session: VaultSession;
  /** This Mac's name: commits carry it, so another Mac's conflict copies can say where they came from. */
  readonly mac: string;
  /** The `_index/` files the notes give, written before every commit. */
  readonly derivedFiles: DerivedFiles;
  /** Writes typing not saved yet, before anything is committed. */
  readonly flush?: () => Promise<void>;
}

/**
 * Why sync is off: the vault folder is not a git repository, or its branch
 * has no upstream (no remote, or never pushed with `-u`). The app works the
 * same; nothing is committed.
 */
export type SyncOff = 'not-a-repo' | 'no-upstream';

/**
 * Why a sync stopped. Nothing is lost: what was not pushed is committed
 * here and goes with the next sync. `auth`: git's login was refused.
 * `unreachable`: offline, or the remote is gone. `rejected`: the remote kept
 * moving under every retry. `error`: anything else, said in the message.
 */
export type SyncFailure = 'auth' | 'unreachable' | 'rejected' | 'error';

export type SyncResult =
  | {
      readonly kind: 'synced';
      /** Whether this Mac's changes were committed. */
      readonly committed: boolean;
      /** Whether other Macs' changes were merged in. */
      readonly pulled: boolean;
      readonly pushed: boolean;
      readonly conflicts: readonly SyncConflict[];
    }
  | { readonly kind: 'off'; readonly reason: SyncOff; readonly message: string }
  | { readonly kind: 'failed'; readonly reason: SyncFailure; readonly message: string };

/** One round of sync. The scheduler decides when, and never runs two at once. */
export type SyncNow = () => Promise<SyncResult>;

/** How many times a push the remote refused (it moved) is fetched, merged and tried again. */
export const MAX_PUSH_ATTEMPTS = 3;

const OFF: Readonly<Record<SyncOff, SyncResult>> = {
  'not-a-repo': {
    kind: 'off',
    reason: 'not-a-repo',
    message: 'The vault folder is not a git repository, so it does not sync.',
  },
  'no-upstream': {
    kind: 'off',
    reason: 'no-upstream',
    message: 'The vault’s branch has no remote to sync with.',
  },
};

/**
 * Syncs the vault the way DFAI does, with the Mac's own git: write the
 * index, commit this Mac's changes, fetch, merge the other Macs' (a merge,
 * never a rebase), settle any conflict so no text is lost, commit the
 * merge, push. A refused push fetches, merges and pushes again, a few
 * times; nothing is ever forced.
 */
export function createSyncNow(deps: SyncDeps): SyncNow {
  return async () => {
    try {
      return await syncOnce(deps);
    } catch (error) {
      return failed(error);
    }
  };
}

async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  const { git } = deps;
  await deps.flush?.();
  if ((await git.run({ kind: 'isRepo' })).code !== 0) return OFF['not-a-repo'];
  const status = await readStatus(git);
  if (status.upstream === null) return OFF['no-upstream'];
  const conflicts: SyncConflict[] = [];
  // A merge an earlier sync left part-way (the app quit) refuses every merge after it.
  if (status.conflicts.length > 0 || (await mergeInProgress(git))) {
    conflicts.push(...(await concludeMerge(deps, status.conflicts)));
  }
  const committed = await commitChanges(deps);
  let pulled = false;
  for (let attempt = 1; ; attempt += 1) {
    await runOk(git, { kind: 'fetch' }, 'fetch from the remote');
    pulled = (await mergeUpstream(deps, conflicts)) || pulled;
    if (!hasUnpushed(await readStatus(git))) {
      return { kind: 'synced', committed, pulled, pushed: false, conflicts };
    }
    const push = await git.run({ kind: 'push' });
    if (push.code === 0) return { kind: 'synced', committed, pulled, pushed: true, conflicts };
    const error = new GitStepError('push to the remote', push);
    if (error.kind !== 'rejected' || attempt >= MAX_PUSH_ATTEMPTS) throw error;
  }
}

/** Writes the index, then commits everything changed; says whether there was anything. */
async function commitChanges(deps: SyncDeps): Promise<boolean> {
  await writeIndexFiles(deps, deps.derivedFiles);
  const { changed } = await readStatus(deps.git);
  if (changed.length === 0) return false;
  await runOk(deps.git, { kind: 'addAll' }, 'stage the changes');
  const message = syncCommitMessage({ changed, mac: deps.mac });
  await runOk(deps.git, { kind: 'commit', message }, 'commit the changes');
  return true;
}

/** Merges the upstream when it has commits this Mac lacks; says whether it did. */
async function mergeUpstream(deps: SyncDeps, conflicts: SyncConflict[]): Promise<boolean> {
  const { behind } = await readStatus(deps.git);
  if (behind === null || behind === 0) return false;
  const merge = await deps.git.run({ kind: 'merge', message: mergeCommitMessage(deps.mac) });
  if (merge.code === 0) {
    await reloadVault(deps);
    // The merged notes may call for a different index than either side had.
    await commitChanges(deps);
    return true;
  }
  const stopped = await readStatus(deps.git);
  // A merge that stopped for another reason is not one to settle by guessing.
  if (stopped.conflicts.length === 0) throw new GitStepError('merge the remote’s changes', merge);
  conflicts.push(...(await concludeMerge(deps, stopped.conflicts)));
  return true;
}

/** Settles the conflicts, writes the index afresh from the merged notes, and commits the merge. */
async function concludeMerge(
  deps: SyncDeps,
  conflicts: readonly GitConflict[],
): Promise<SyncConflict[]> {
  const copies = await settleConflicts(deps, conflicts);
  await reloadVault(deps);
  await writeIndexFiles(deps, deps.derivedFiles);
  await runOk(deps.git, { kind: 'addAll' }, 'stage the settled merge');
  const message = mergeCommitMessage(deps.mac);
  await runOk(deps.git, { kind: 'commit', message }, 'commit the merge');
  return copies;
}

/** Commits the remote lacks; a branch not on the remote yet has all of its own. */
function hasUnpushed(status: GitStatus): boolean {
  return status.ahead === null ? status.born : status.ahead > 0;
}

function failed(error: unknown): SyncResult {
  if (error instanceof GitStepError) {
    return { kind: 'failed', reason: error.kind, message: error.message };
  }
  if (error instanceof FileChangedError) {
    return {
      kind: 'failed',
      reason: 'error',
      message: 'A note changed while it synced; sync will try again.',
    };
  }
  const message = error instanceof Error ? error.message : 'Sync failed.';
  return { kind: 'failed', reason: 'error', message };
}
