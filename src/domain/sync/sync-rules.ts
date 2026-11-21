import { INDEX_FOLDER, isWithin, noteTitle, type VaultPath } from '../vault/index.ts';
import type { GitConflict } from './git-status.ts';

/** The trailer every commit the app makes ends with, naming the Mac it came from. */
const FROM = 'From: ';

/**
 * A commit's message: `Notes: <title>` for one note, `Notes: <n> changed`
 * for several, `Notes: index` when only `_index/` changed, then which Mac.
 */
export function syncCommitMessage({
  changed,
  mac,
}: {
  changed: readonly VaultPath[];
  mac: string;
}): string {
  const notes = changed.filter((path) => !isWithin(path, INDEX_FOLDER));
  const [only] = notes;
  const subject =
    notes.length === 0
      ? 'Notes: index'
      : notes.length === 1 && only !== undefined
        ? `Notes: ${noteTitle(only)}`
        : `Notes: ${notes.length} changed`;
  return `${subject}\n\n${FROM}${mac}`;
}

/** A merge commit's message: what it brought in, and which Mac made it. */
export function mergeCommitMessage(mac: string): string {
  return `Notes: merge\n\n${FROM}${mac}`;
}

/** The Mac a commit says it came from; null when the app did not make it (Claude, say). */
export function macOfCommit(message: string): string | null {
  for (const line of message.split('\n').reverse()) {
    if (line.startsWith(FROM) && line.length > FROM.length) return line.slice(FROM.length).trim();
  }
  return null;
}

/** What to do with a file a merge left in conflict. */
export type ConflictStep =
  /** `_index/`: generated, so written afresh from the merged notes. */
  | 'regenerate'
  /** Both sides changed it: this Mac's stays at the path, the other's is saved beside it. */
  | 'keep-both'
  /** One side deleted it, the other changed it, or only one side has it: the file stays. */
  | 'keep-file'
  /** Both sides deleted it. */
  | 'drop';

/** How a conflict is settled. A delete never beats an edit. */
export function conflictStep({ path, code }: GitConflict): ConflictStep {
  if (isWithin(path, INDEX_FOLDER)) return 'regenerate';
  if (code === 'UU' || code === 'AA') return 'keep-both';
  if (code === 'DD') return 'drop';
  return 'keep-file';
}

/**
 * Why a git run that reached the remote failed, from what git said in
 * English (the host runs it with `LC_ALL=C`). A run stopped at its time
 * limit (`code` null) is unreachable.
 */
export type GitFailureKind = 'auth' | 'unreachable' | 'rejected' | 'error';

const AUTH =
  /authentication failed|permission denied|could not read username|terminal prompts disabled|returned error: 40[13]|access denied|denied to /i;
const UNREACHABLE =
  /could not resolve host|unable to access|connection (refused|timed out|reset)|network is unreachable|operation timed out|does not appear to be a git repository|could not read from remote repository|stopped git after/i;
const REJECTED = /\[rejected\]|\[remote rejected\]|fetch first|non-fast-forward/i;

export function gitFailureKind({
  code,
  stderr,
}: {
  code: number | null;
  stderr: string;
}): GitFailureKind {
  if (code === null) return 'unreachable';
  if (REJECTED.test(stderr)) return 'rejected';
  if (AUTH.test(stderr)) return 'auth';
  if (UNREACHABLE.test(stderr)) return 'unreachable';
  return 'error';
}
