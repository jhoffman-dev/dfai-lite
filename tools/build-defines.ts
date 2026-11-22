// What the build stamps into the app (Vite `define`): the version from
// package.json and the commit it was built from. `src/app/build-info.ts`
// is the one module that reads them.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The short commit, with `+` when the tree has changes not committed; `dev` when git cannot say. */
export function buildCommit(root: string): string {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const commit = git('rev-parse', '--short', 'HEAD').trim();
    return git('status', '--porcelain', '--untracked-files=no').trim() === ''
      ? commit
      : `${commit}+`;
  } catch {
    // No git, not a clone, or git refusing to run: the build still works, just unstamped.
    return 'dev';
  }
}

export function buildDefines(root: string): Record<string, string> {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version: string;
  };
  return {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(buildCommit(root)),
  };
}
