// The git port through Node's child_process, for the real-git sync tests:
// the same fixed argument shapes, prefix and quiet environment as the Rust
// host (src-tauri/src/git.rs), test-only.
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import type { GitCommand, GitPort, GitResult } from '../../src/application/index.ts';

/** As `FIXED_PREFIX` in src-tauri/src/git.rs. */
const FIXED_PREFIX = [
  ...['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'],
  ...['-c', 'core.quotePath=false', '-c', 'protocol.ext.allow=never'],
  ...['-c', 'color.ui=never', '-c', 'commit.gpgSign=false', '-c', 'merge.ff=true'],
  ...['-c', 'core.autocrlf=false', '-c', 'merge.conflictStyle=merge'],
  ...['-c', 'push.default=upstream', '--literal-pathspecs', '--no-optional-locks'],
];

/** As `args_of` in src-tauri/src/git.rs. */
export function argsOf(command: GitCommand): string[] {
  switch (command.kind) {
    case 'isRepo':
      return ['rev-parse', '--is-inside-work-tree'];
    case 'status':
      return ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'];
    case 'addAll':
      return ['add', '--all'];
    case 'commit':
      return ['commit', '--quiet', '--no-verify', `--message=${command.message}`];
    case 'fetch':
      return ['fetch', '--quiet'];
    case 'merge':
      return ['merge', '--no-edit', '--no-stat', `--message=${command.message}`, '@{upstream}'];
    case 'push':
      return ['push', '--quiet'];
    case 'mergeInProgress':
      return ['rev-parse', '-q', '--verify', 'MERGE_HEAD'];
    case 'showSide':
      return ['cat-file', 'blob', `:${command.side === 'ours' ? 2 : 3}:${command.path}`];
    case 'checkoutOurs':
      return ['checkout', '--ours', '--', command.path];
    case 'upstreamMessage':
      return ['log', '-1', '--format=%B', '@{upstream}', '--'];
    case 'remoteUrl':
      return ['ls-remote', '--get-url'];
  }
}

/** A run of `git` in `cwd`, with no shell, as the host runs it. */
export function runGit(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...FIXED_PREFIX, ...args],
      { cwd, env: { ...env, GIT_CEILING_DIRECTORIES: dirname(cwd) }, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

export class NodeGit implements GitPort {
  /** Every command run, in order: what a test may wrap or count. */
  readonly ran: GitCommand[] = [];
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly mac: string;

  constructor({ cwd, env, mac }: { cwd: string; env: NodeJS.ProcessEnv; mac: string }) {
    this.cwd = cwd;
    this.env = env;
    this.mac = mac;
  }

  run(command: GitCommand): Promise<GitResult> {
    this.ran.push(command);
    return runGit(this.cwd, argsOf(command), this.env);
  }

  async macName(): Promise<string> {
    return this.mac;
  }
}
