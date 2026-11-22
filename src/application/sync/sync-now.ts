import {
  deletionsToConfirm,
  icloudStubs,
  mergeCommitMessage,
  syncCommitMessage,
  type GitConflict,
  type GitStatus,
} from '../../domain/sync/index.ts';
import { isTextFile, type VaultPath } from '../../domain/vault/index.ts';
import { FileChangedError, type GitPort, type VaultFiles } from '../ports/index.ts';
import type { VaultSession } from '../session/index.ts';
import { reloadVault } from '../use-cases/index.ts';
import type { DeletionApprovals } from './deletion-approvals.ts';
import { GitStepError, operationInProgress, readStatus, runOk } from './git-steps.ts';
import { followCaseRenames, keepUnsyncableOut, trackedFiles } from './prepare-commit.ts';
import { settleConflicts, type SyncConflict } from './settle-conflicts.ts';
import type { WriteGate } from './write-gate.ts';
import { writeIndexFiles, type DerivedFiles } from './write-index.ts';

/** What sync needs. */
export interface SyncDeps {
  readonly git: GitPort;
  /** The vault's files, not behind the gate: sync holds the gate itself. */
  readonly files: VaultFiles;
  readonly session: VaultSession;
  /** This Mac's name: commits carry it, so another Mac's conflict copies can say where they came from. */
  readonly mac: string;
  /** The `_index/` files the notes give, written before every commit. */
  readonly derivedFiles: DerivedFiles;
  /** Shut while sync commits and merges; everything else writes through it. */
  readonly gate: WriteGate;
  /** Many deletions wait for the person's yes here. */
  readonly approvals: DeletionApprovals;
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
 * Why sync stopped before touching anything, until the person acts outside
 * the app: a merge, cherry-pick, revert or rebase waits to be finished in
 * git (`merge-in-progress`), the folder is on no branch (`detached`), or
 * iCloud moved notes off this Mac (`icloud-evicted`).
 */
export type SyncBlock = 'merge-in-progress' | 'detached' | 'icloud-evicted';

/**
 * Why a sync stopped. Nothing is lost: what was not pushed is committed
 * here and goes with the next sync. `auth`: git's login was refused.
 * `unreachable`: offline, or the remote is gone. `rejected`: the remote kept
 * moving under every retry. `locked`: another git holds the index.
 * `error`: anything else, said in the message.
 */
export type SyncFailure = 'auth' | 'unreachable' | 'rejected' | 'locked' | 'error';

export type SyncResult =
  | {
      readonly kind: 'synced';
      /** Whether this Mac's changes were committed. */
      readonly committed: boolean;
      /** Whether other Macs' changes were merged in. */
      readonly pulled: boolean;
      readonly pushed: boolean;
      readonly conflicts: readonly SyncConflict[];
      /** What was left out of the sync, and why: files too large, nested repositories, foreign index files. */
      readonly warnings: readonly string[];
    }
  | { readonly kind: 'off'; readonly reason: SyncOff; readonly message: string }
  | { readonly kind: 'blocked'; readonly reason: SyncBlock; readonly message: string }
  /** Many notes are gone from the folder: nothing was committed; approve them to sync the deletions. */
  | {
      readonly kind: 'needs-confirmation';
      readonly deletions: readonly VaultPath[];
      readonly message: string;
    }
  | { readonly kind: 'failed'; readonly reason: SyncFailure; readonly message: string };

/** One round of sync. The scheduler decides when, and never runs two at once. */
export type SyncNow = () => Promise<SyncResult>;

/** How many times a push the remote refused (it moved) is fetched, merged and tried again. */
export const MAX_PUSH_ATTEMPTS = 3;

/** A result that ends the sync early, on purpose. */
class Stop extends Error {
  readonly result: SyncResult;
  constructor(result: SyncResult) {
    super(result.kind);
    this.result = result;
  }
}

const off = (reason: SyncOff): SyncResult => ({
  kind: 'off',
  reason,
  message:
    reason === 'not-a-repo'
      ? 'The vault folder is not a git repository, so it does not sync.'
      : 'The vault’s branch has no remote to sync with.',
});

const BLOCKED: Readonly<Record<SyncBlock, string>> = {
  'merge-in-progress':
    'A merge or rebase is waiting to be finished in this folder. Finish it in git (git status says how); sync waits until then.',
  detached:
    'The vault folder is not on a branch (a rebase in progress?). Finish it in git; sync waits until then.',
  'icloud-evicted':
    'iCloud has moved notes off this Mac. Turn off Optimize Mac Storage, or move the vault out of iCloud Drive; sync waits until then.',
};

const blocked = (reason: SyncBlock): SyncResult => ({
  kind: 'blocked',
  reason,
  message: BLOCKED[reason],
});

/**
 * Syncs the vault the way DFAI does, with the Mac's own git: write the
 * index, commit this Mac's changes, fetch, merge the other Macs' (a merge,
 * never a rebase), settle the conflicts of that merge so no text is lost,
 * commit it, push. A refused push fetches, merges and pushes again, a few
 * times; nothing is ever forced. A merge it did not start is never touched.
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
  if ((await git.run({ kind: 'isRepo' })).code !== 0) return off('not-a-repo');
  const status = await readStatus(git);
  if (status.conflicts.length > 0 || (await operationInProgress(git))) {
    return blocked('merge-in-progress');
  }
  if (status.branch === null) return blocked('detached');
  if (status.upstream === null) return off('no-upstream');
  if (icloudStubs(status.changed).length > 0) return blocked('icloud-evicted');
  const conflicts: SyncConflict[] = [];
  const warnings: string[] = [];
  const committed = await held(deps, () => commitChanges(deps, warnings));
  let pulled = false;
  for (let attempt = 1; ; attempt += 1) {
    await runOk(git, { kind: 'fetch' }, 'fetch from the remote');
    pulled = (await held(deps, () => mergeUpstream(deps, { conflicts, warnings }))) || pulled;
    const done = { kind: 'synced', committed, pulled, conflicts, warnings } as const;
    if (!hasUnpushed(await readStatus(git))) return { ...done, pushed: false };
    const push = await git.run({ kind: 'push' });
    if (push.code === 0) return { ...done, pushed: true };
    const error = new GitStepError('push to the remote', push);
    if (error.kind !== 'rejected' || attempt >= MAX_PUSH_ATTEMPTS) throw error;
  }
}

/** Writes what is typed, then runs `work` with the gate shut: no save lands mid-commit or mid-merge. */
async function held<T>(deps: SyncDeps, work: () => Promise<T>): Promise<T> {
  await deps.flush?.();
  const release = deps.gate.hold();
  try {
    return await work();
  } finally {
    release();
  }
}

/**
 * Keeps what must not sync out, writes the index, then commits everything
 * changed; says whether there was anything. Many deletions stop it until
 * the person approves them.
 */
async function commitChanges(deps: SyncDeps, warnings: string[]): Promise<boolean> {
  warnings.push(...(await keepUnsyncableOut(deps.files)));
  warnings.push(...(await writeIndexFiles(deps, deps.derivedFiles)).warnings);
  const tracked = await trackedFiles(deps.git);
  let status = await readStatus(deps.git);
  if (await followCaseRenames(deps, { tracked, deleted: status.deleted })) {
    status = await readStatus(deps.git);
  }
  if (status.changed.length === 0) return false;
  const deletions = deletionsToConfirm({ deleted: status.deleted, tracked });
  if (deletions.length > 0 && !deps.approvals.covers(deletions)) {
    throw new Stop(needsConfirmation(deletions));
  }
  await runOk(deps.git, { kind: 'addAll' }, 'stage the changes');
  const message = syncCommitMessage({ changed: status.changed, mac: deps.mac });
  await runOk(deps.git, { kind: 'commit', message }, 'commit the changes');
  deps.approvals.clear();
  return true;
}

function needsConfirmation(deletions: readonly VaultPath[]): SyncResult {
  const shown = deletions.slice(0, 3).join(', ');
  const more = deletions.length > 3 ? ` and ${deletions.length - 3} more` : '';
  return {
    kind: 'needs-confirmation',
    deletions,
    message: `${deletions.length} notes are missing from this folder (${shown}${more}). Sync the deletions?`,
  };
}

/** Merges the upstream when it has commits this Mac lacks; says whether it did. */
async function mergeUpstream(
  deps: SyncDeps,
  { conflicts, warnings }: { conflicts: SyncConflict[]; warnings: string[] },
): Promise<boolean> {
  const { behind } = await readStatus(deps.git);
  if (behind === null || behind === 0) return false;
  const merge = await deps.git.run({ kind: 'merge', message: mergeCommitMessage(deps.mac) });
  if (merge.code === 0) {
    await reloadVault(deps);
    // The merged notes may call for a different index than either side had.
    await commitChanges(deps, warnings);
    return true;
  }
  const stopped = await readStatus(deps.git);
  // A merge that stopped for another reason is not one to settle by guessing.
  if (stopped.conflicts.length === 0) throw new GitStepError('merge the remote’s changes', merge);
  const marked = new Map<VaultPath, string | null>();
  for (const { path } of stopped.conflicts) {
    if (isTextFile(path)) marked.set(path, await deps.files.read(path));
  }
  conflicts.push(
    ...(await concludeMerge(deps, { conflicts: stopped.conflicts, marked, warnings })),
  );
  return true;
}

/** Settles this sync's own merge, writes the index afresh from the merged notes, and commits it. */
async function concludeMerge(
  deps: SyncDeps,
  {
    conflicts,
    marked,
    warnings,
  }: {
    conflicts: readonly GitConflict[];
    marked: ReadonlyMap<VaultPath, string | null>;
    warnings: string[];
  },
): Promise<SyncConflict[]> {
  const copies = await settleConflicts(deps, { conflicts, marked });
  await reloadVault(deps);
  warnings.push(...(await writeIndexFiles(deps, deps.derivedFiles)).warnings);
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
  if (error instanceof Stop) return error.result;
  if (error instanceof GitStepError) {
    const message =
      error.kind === 'locked'
        ? `${error.message} Another git is using this vault. If none is running, delete .git/index.lock in the vault folder, then sync again.`
        : error.message;
    return { kind: 'failed', reason: error.kind, message };
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
