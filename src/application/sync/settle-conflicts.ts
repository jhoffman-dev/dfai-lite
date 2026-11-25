import {
  conflictCopyPath,
  conflictStep,
  macOfCommit,
  type GitConflict,
} from '../../domain/sync/index.ts';
import { MEETING_QUEUE_PATH, mergeMeetingQueues } from '../../domain/meetings/index.ts';
import { isTextFile, type VaultPath } from '../../domain/vault/index.ts';
import { FileChangedError, type GitPort, type VaultFiles } from '../ports/index.ts';
import type { VaultSession } from '../session/index.ts';
import { runOk } from './git-steps.ts';

/** A file both sides changed: this Mac's version stayed at `path`, another went to `copy`. */
export interface SyncConflict {
  readonly path: VaultPath;
  readonly copy: VaultPath;
}

interface SettleDeps {
  readonly git: GitPort;
  readonly files: VaultFiles;
  readonly session: VaultSession;
  /** This Mac's name: text written into a file while its merge settled is kept under it. */
  readonly mac: string;
}

/**
 * Settles every file the merge this sync just ran left in conflict, so no
 * note is left holding conflict markers and no text is lost (as DFAI does):
 *
 * - both changed it: this Mac's version stays at the path, the other's is
 *   saved beside it as `<name> (conflict from <Mac>)`, a file that is not
 *   text byte for byte;
 * - one side deleted it and the other changed it: the changed file stays
 *   (git left it in the folder), since a delete never beats an edit;
 * - `_index/`: left for the caller to write afresh from the merged notes;
 * - the meetings queue: both Macs' lines kept in the one file, never a copy,
 *   since one Mac adds lines while Claude takes them out on another.
 *
 * `marked` is what each text file held the moment git stopped: if a file
 * holds anything else when it is settled (someone typed into it), that text
 * is kept as a further copy before this Mac's version goes back.
 */
export async function settleConflicts(
  deps: SettleDeps,
  {
    conflicts,
    marked,
  }: { conflicts: readonly GitConflict[]; marked: ReadonlyMap<VaultPath, string | null> },
): Promise<SyncConflict[]> {
  const other = await otherMac(deps.git);
  const taken = new Set(deps.session.takenPaths());
  const copies: SyncConflict[] = [];
  const copyFor = (path: VaultPath, mac: string) => {
    const copy = conflictCopyPath({ path, mac, taken });
    taken.add(copy);
    copies.push({ path, copy });
    return copy;
  };
  for (const conflict of conflicts) {
    if (conflictStep(conflict) !== 'keep-both') continue;
    const { path } = conflict;
    const atMerge = marked.get(path) ?? null;
    if (path === MEETING_QUEUE_PATH) await keepBothQueues(deps, { path, marked: atMerge });
    else if (isTextFile(path)) await keepBothTexts(deps, { path, marked: atMerge, other, copyFor });
    else await keepBothFiles(deps, { path, copy: copyFor(path, other) });
  }
  return copies;
}

type CopyFor = (path: VaultPath, mac: string) => VaultPath;

async function keepBothTexts(
  { git, files, mac }: SettleDeps,
  {
    path,
    marked,
    other,
    copyFor,
  }: { path: VaultPath; marked: string | null; other: string; copyFor: CopyFor },
): Promise<void> {
  const ours = await runOk(git, { kind: 'showSide', side: 'ours', path }, `read ${path}`);
  const theirs = await runOk(git, { kind: 'showSide', side: 'theirs', path }, `read ${path}`);
  if (ours !== theirs)
    await files.write({ path: copyFor(path, other), text: theirs, expected: null });
  let expected = marked;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await files.write({ path, text: ours, expected });
      return;
    } catch (error) {
      if (!(error instanceof FileChangedError)) throw error;
      // Someone wrote into the file since git did: keep what they wrote before putting ours back.
      const written = await files.read(path);
      if (written !== null && written !== ours) {
        await files.write({ path: copyFor(path, mac), text: written, expected: null });
      }
      expected = written;
    }
  }
  throw new FileChangedError(`${path} kept changing while it was settled.`);
}

/**
 * Both sides' meetings queues as one at the path. Lines written into the
 * file since git stopped (Claude, in Terminal) join it too, so a queued
 * meeting is never dropped; a line one side removed may come back, which
 * costs Claude one look at a note that already has its summary.
 */
async function keepBothQueues(
  { git, files }: SettleDeps,
  { path, marked }: { path: VaultPath; marked: string | null },
): Promise<void> {
  const ours = await runOk(git, { kind: 'showSide', side: 'ours', path }, `read ${path}`);
  const theirs = await runOk(git, { kind: 'showSide', side: 'theirs', path }, `read ${path}`);
  let merged = mergeMeetingQueues(ours, theirs);
  let expected = marked;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await files.write({ path, text: merged, expected });
      return;
    } catch (error) {
      if (!(error instanceof FileChangedError)) throw error;
      const written = await files.read(path);
      if (written !== null) merged = mergeMeetingQueues(merged, written);
      expected = written;
    }
  }
  throw new FileChangedError(`${path} kept changing while it was settled.`);
}

/** This Mac's side stays at the path; the other's is written beside it from git's own copy, byte for byte. */
async function keepBothFiles(
  { git }: SettleDeps,
  { path, copy }: { path: VaultPath; copy: VaultPath },
): Promise<void> {
  await runOk(git, { kind: 'checkoutOurs', path }, `keep this Mac’s ${path}`);
  await runOk(git, { kind: 'saveSide', side: 'theirs', path, to: copy }, `save the other ${path}`);
}

/** The Mac the other side came from, as its last commit says; "another Mac" when it does not. */
async function otherMac(git: GitPort): Promise<string> {
  const result = await git.run({ kind: 'upstreamMessage' });
  return (result.code === 0 ? macOfCommit(result.stdout) : null) ?? 'another Mac';
}
