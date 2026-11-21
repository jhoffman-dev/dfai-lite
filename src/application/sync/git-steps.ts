import {
  gitFailureKind,
  parseGitStatus,
  type GitFailureKind,
  type GitStatus,
} from '../../domain/sync/index.ts';
import type { GitCommand, GitPort, GitResult } from '../ports/index.ts';

/** A git run that failed, with what it was for and what git said. */
export class GitStepError extends Error {
  override readonly name = 'GitStepError';
  readonly kind: GitFailureKind;
  readonly result: GitResult;

  constructor(step: string, result: GitResult) {
    const said = result.stderr.trim().split('\n').at(-1) ?? '';
    super(`Could not ${step}${said === '' ? '.' : `: ${said}`}`);
    this.kind = gitFailureKind(result);
    this.result = result;
  }
}

/** Runs the command; its output when it succeeded, else a {@link GitStepError} saying `step`. */
export async function runOk(git: GitPort, command: GitCommand, step: string): Promise<string> {
  const result = await git.run(command);
  if (result.code !== 0) throw new GitStepError(step, result);
  return result.stdout;
}

export async function readStatus(git: GitPort): Promise<GitStatus> {
  return parseGitStatus(await runOk(git, { kind: 'status' }, 'read the vault’s git status'));
}

/** Whether a merge waits to be committed: one an earlier sync left part-way. */
export async function mergeInProgress(git: GitPort): Promise<boolean> {
  return (await git.run({ kind: 'mergeInProgress' })).code === 0;
}
