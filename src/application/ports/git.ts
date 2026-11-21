import type { VaultPath } from '../../domain/vault/index.ts';

/**
 * Every git command the app runs, by shape. The host alone turns one into
 * arguments, so a note's name is only ever a path (after `--`, or inside a
 * `:<stage>:<path>` revision) and a message only ever the value of one
 * argument. Each runs in the vault folder, never prompts, and has a time limit.
 */
export type GitCommand =
  /** `rev-parse --is-inside-work-tree` */
  | { readonly kind: 'isRepo' }
  /** `status --porcelain=v2 --branch -z --untracked-files=all` */
  | { readonly kind: 'status' }
  /** `add --all` */
  | { readonly kind: 'addAll' }
  /** `commit --quiet --no-verify --message=<message>` */
  | { readonly kind: 'commit'; readonly message: string }
  /** `fetch --quiet` */
  | { readonly kind: 'fetch' }
  /** `merge --no-edit --no-stat --message=<message> @{upstream}`: a merge, never a rebase. */
  | { readonly kind: 'merge'; readonly message: string }
  /** `push --quiet` to the upstream: never forced. */
  | { readonly kind: 'push' }
  /** `rev-parse -q --verify MERGE_HEAD`: succeeds while a merge waits to be committed. */
  | { readonly kind: 'mergeInProgress' }
  /** `cat-file blob :2:<path>` (ours) or `:3:<path>` (theirs): one side of a conflicted file. */
  | { readonly kind: 'showSide'; readonly side: 'ours' | 'theirs'; readonly path: VaultPath }
  /** `checkout --ours -- <path>`: this Mac's side of a conflicted file that is not text. */
  | { readonly kind: 'checkoutOurs'; readonly path: VaultPath }
  /** `log -1 --format=%B @{upstream} --`: the other Macs' last commit message. */
  | { readonly kind: 'upstreamMessage' }
  /** `ls-remote --get-url`: where the branch syncs to. */
  | { readonly kind: 'remoteUrl' };

/** What one run said. `code` is null when the host stopped it at its time limit. */
export interface GitResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The Mac's own `git`, in the vault folder, with the login git already has:
 * the app holds no token. Rejects only when git could not be run at all (not
 * installed); a run that failed resolves with its code and stderr.
 */
export interface GitPort {
  run(command: GitCommand): Promise<GitResult>;
  /** This Mac's name as Sharing shows it: commits and conflict copies carry it. */
  macName(): Promise<string>;
}
