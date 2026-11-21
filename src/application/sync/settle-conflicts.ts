import {
  conflictCopyPath,
  conflictStep,
  macOfCommit,
  type GitConflict,
} from '../../domain/sync/index.ts';
import { isTextFile, type VaultPath } from '../../domain/vault/index.ts';
import type { GitPort, VaultFiles } from '../ports/index.ts';
import type { VaultSession } from '../session/index.ts';
import { runOk } from './git-steps.ts';

/** A file both Macs changed: this Mac's version stayed at `path`, the other's went to `copy`. */
export interface SyncConflict {
  readonly path: VaultPath;
  readonly copy: VaultPath;
}

interface SettleDeps {
  readonly git: GitPort;
  readonly files: VaultFiles;
  readonly session: VaultSession;
}

/**
 * Settles every file a merge left in conflict, so no note is left holding
 * conflict markers and no text is lost (as DFAI does):
 *
 * - both changed it: this Mac's version stays at the path, the other's is
 *   saved beside it as `<name> (conflict from <Mac>).md`;
 * - one side deleted it and the other changed it: the changed file stays
 *   (git left it in the folder), since a delete never beats an edit;
 * - `_index/`: left for the caller to write afresh from the merged notes.
 *
 * A file that is not text keeps this Mac's side; the other's stays in the
 * merge's history. The caller stages and commits afterwards.
 */
export async function settleConflicts(
  deps: SettleDeps,
  conflicts: readonly GitConflict[],
): Promise<SyncConflict[]> {
  const other = await otherMac(deps.git);
  const taken = new Set(deps.session.takenPaths());
  const copies: SyncConflict[] = [];
  for (const conflict of conflicts) {
    if (conflictStep(conflict) !== 'keep-both') continue;
    const copy = await keepBoth(deps, { path: conflict.path, other, taken });
    if (copy !== null) {
      taken.add(copy);
      copies.push({ path: conflict.path, copy });
    }
  }
  return copies;
}

/** Writes this Mac's side over the file git marked up, and the other's beside it; says where. */
async function keepBoth(
  { git, files }: SettleDeps,
  { path, other, taken }: { path: VaultPath; other: string; taken: ReadonlySet<VaultPath> },
): Promise<VaultPath | null> {
  if (!isTextFile(path)) {
    await runOk(git, { kind: 'checkoutOurs', path }, `keep this Mac’s ${path}`);
    return null;
  }
  const ours = await runOk(git, { kind: 'showSide', side: 'ours', path }, `read ${path}`);
  const theirs = await runOk(git, { kind: 'showSide', side: 'theirs', path }, `read ${path}`);
  await files.write({ path, text: ours, expected: await files.read(path) });
  if (ours === theirs) return null;
  const copy = conflictCopyPath({ path, mac: other, taken });
  await files.write({ path: copy, text: theirs, expected: null });
  return copy;
}

/** The Mac the other side came from, as its last commit says; "another Mac" when it does not. */
async function otherMac(git: GitPort): Promise<string> {
  const result = await git.run({ kind: 'upstreamMessage' });
  return (result.code === 0 ? macOfCommit(result.stdout) : null) ?? 'another Mac';
}
