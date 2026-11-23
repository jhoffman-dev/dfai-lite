// The build's stamp against real git, in temp folders.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCommit, buildDefines } from './build-defines.ts';

const made: string[] = [];
async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dfai-lite-build-'));
  made.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function gitRepo(dir: string): string {
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Mara Quill',
        '-c',
        'user.email=mara@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      {
        cwd: dir,
        encoding: 'utf8',
      },
    );
  git('init', '-q');
  git('add', 'package.json');
  git('commit', '-q', '-m', 'first');
  return git('rev-parse', '--short', 'HEAD').trim();
}

describe('the build stamp', () => {
  it('is the short commit of a clean tree, with + once a tracked file changes', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'package.json'), '{ "version": "1.2.3" }\n');
    const commit = gitRepo(dir);
    expect(buildCommit(dir)).toBe(commit);
    await writeFile(join(dir, 'package.json'), '{ "version": "1.2.4" }\n');
    expect(buildCommit(dir)).toBe(`${commit}+`);
  });

  it('is dev outside a git clone', async () => {
    expect(buildCommit(await folder())).toBe('dev');
  });

  it('hands Vite the version from package.json, as source text', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'package.json'), '{ "version": "1.2.3" }\n');
    expect(buildDefines(dir)).toEqual({ __APP_VERSION__: '"1.2.3"', __APP_COMMIT__: '"dev"' });
  });
});
