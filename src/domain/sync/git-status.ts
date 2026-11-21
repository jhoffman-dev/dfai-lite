import type { VaultPath } from '../vault/index.ts';

/**
 * A file a merge left in conflict, with git's two-letter code: `UU` both
 * changed, `AA` both added, `UD`/`DU` changed on one side and deleted on
 * the other (`D` is the deleting side: us first, them second), `AU`/`UA`
 * added on one side only, `DD` deleted on both.
 */
export interface GitConflict {
  readonly path: VaultPath;
  readonly code: string;
}

/** What `git status --porcelain=v2 --branch -z --untracked-files=all` said. */
export interface GitStatus {
  /** The branch checked out; null when detached. */
  readonly branch: string | null;
  /** Whether the branch has a commit yet. */
  readonly born: boolean;
  /** `origin/main`, say; null when the branch has none. */
  readonly upstream: string | null;
  /**
   * Commits ahead of and behind the upstream; null when the upstream is set
   * but not on the remote yet (a new, empty repository).
   */
  readonly ahead: number | null;
  readonly behind: number | null;
  /** Every changed or new path that is not in conflict, sorted. */
  readonly changed: readonly VaultPath[];
  /** The tracked paths among them that are gone from the folder (or staged as gone), sorted. */
  readonly deleted: readonly VaultPath[];
  readonly conflicts: readonly GitConflict[];
}

/** How many space-separated fields come before the path, by entry kind. */
const FIELDS_BEFORE_PATH: Readonly<Record<string, number>> = { '1': 8, '2': 9, u: 10, '?': 1 };

function afterFields(entry: string, count: number): string {
  let at = 0;
  for (let field = 0; field < count; field += 1) at = entry.indexOf(' ', at) + 1;
  return entry.slice(at);
}

function readHeader(line: string, status: { -readonly [K in keyof GitStatus]: GitStatus[K] }) {
  const [, key, value = ''] = /^# (\S+) (.*)$/.exec(line) ?? [];
  if (key === 'branch.oid') status.born = value !== '(initial)';
  else if (key === 'branch.head') status.branch = value === '(detached)' ? null : value;
  else if (key === 'branch.upstream') status.upstream = value;
  else if (key === 'branch.ab') {
    const [, ahead, behind] = /^\+(\d+) -(\d+)$/.exec(value) ?? [];
    status.ahead = ahead === undefined ? null : Number(ahead);
    status.behind = behind === undefined ? null : Number(behind);
  }
}

/** Reads git's machine status. Paths are as git spells them (`core.quotePath=false`). */
export function parseGitStatus(output: string): GitStatus {
  const status: { -readonly [K in keyof GitStatus]: GitStatus[K] } = {
    branch: null,
    born: false,
    upstream: null,
    ahead: null,
    behind: null,
    changed: [],
    deleted: [],
    conflicts: [],
  };
  const changed: VaultPath[] = [];
  const deleted: VaultPath[] = [];
  const conflicts: GitConflict[] = [];
  const entries = output.split('\0');
  for (let at = 0; at < entries.length; at += 1) {
    const entry = entries[at] ?? '';
    const kind = entry.slice(0, entry.indexOf(' '));
    if (kind === '#') readHeader(entry, status);
    else if (kind === 'u') {
      conflicts.push({ path: afterFields(entry, 10), code: entry.slice(2, 4) });
    } else if (FIELDS_BEFORE_PATH[kind] !== undefined) {
      const path = afterFields(entry, FIELDS_BEFORE_PATH[kind]);
      changed.push(path);
      if (kind === '1' && entry.slice(2, 4).includes('D')) deleted.push(path);
      // A rename's old path is the next entry: it changed too (it is gone).
      if (kind === '2') changed.push(entries[(at += 1)] ?? '');
    }
  }
  status.changed = [...new Set(changed)].filter(Boolean).sort();
  status.deleted = deleted.sort();
  status.conflicts = conflicts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return status;
}
