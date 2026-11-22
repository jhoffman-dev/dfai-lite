import { withIgnoreBlock } from '../../domain/sync/index.ts';
import { foldedPath, type VaultPath } from '../../domain/vault/index.ts';
import type { GitPort, VaultFiles } from '../ports/index.ts';
import type { VaultSession } from '../session/index.ts';
import { runOk } from './git-steps.ts';

/** Every path git tracks. */
export async function trackedFiles(git: GitPort): Promise<VaultPath[]> {
  const listed = await runOk(git, { kind: 'trackedFiles' }, 'list the tracked files');
  return listed.split('\0').filter(Boolean);
}

/**
 * Keeps out of `git add --all` what must not sync: the app's own ignore
 * block in the vault's `.gitignore` (temporary files, `.DS_Store`,
 * `.claude/`, `.env`), plus files over GitHub's limit and repositories of
 * their own. The person's lines are never changed. Says what was left out.
 */
export async function keepUnsyncableOut(files: VaultFiles): Promise<string[]> {
  const { tooLarge, nestedRepos } = await files.findUnsyncable();
  const current = await files.readIgnoreFile();
  const next = withIgnoreBlock(current, { skipped: tooLarge, nested: nestedRepos });
  if (next !== current) await files.writeIgnoreFile({ text: next, expected: current });
  return [
    ...tooLarge.map(
      (path) => `${path} is over GitHub’s 100 MB limit; it stays on this Mac and does not sync.`,
    ),
    ...nestedRepos.map((path) => `${path} is a git repository of its own; it does not sync.`),
  ];
}

/**
 * Tells git about notes renamed only in case (`idea.md` to `Idea.md`): on a
 * Mac's disk git cannot see that change, and other Macs would keep the old
 * name. A tracked path that is gone, but whose name is on disk in another
 * case, is moved in git to that case. Says whether it moved any.
 */
export async function followCaseRenames(
  { git, session }: { git: GitPort; session: VaultSession },
  { tracked, deleted }: { tracked: readonly VaultPath[]; deleted: readonly VaultPath[] },
): Promise<boolean> {
  const onDisk = new Set(session.takenPaths());
  const byFold = new Map([...onDisk].map((path) => [foldedPath(path), path]));
  const gone = new Set(deleted);
  let moved = false;
  for (const from of tracked) {
    if (onDisk.has(from) || gone.has(from)) continue;
    const to = byFold.get(foldedPath(from));
    if (to === undefined || to === from) continue;
    await runOk(git, { kind: 'moveCase', from, to }, `rename ${from} to ${to}`);
    moved = true;
  }
  return moved;
}
