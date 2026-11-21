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

const IN_PROGRESS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD'] as const;

/**
 * Whether a merge, cherry-pick, revert or rebase waits to be finished in
 * the folder: started in Terminal, by another tool, or by a sync the app
 * quit during. Not the app's to finish.
 */
export async function operationInProgress(git: GitPort): Promise<boolean> {
  for (const name of IN_PROGRESS) {
    if ((await git.run({ kind: 'refExists', name })).code === 0) return true;
  }
  return false;
}
