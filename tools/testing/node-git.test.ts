import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitCommand } from '../../src/application/index.ts';
import { argsOf, FIXED_PREFIX } from './node-git.ts';

/** The shapes the Rust host is tested against too, so the two cannot drift. */
const shapes = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../src-tauri/git-shapes.json'), 'utf8'),
) as { prefix: string[]; commands: { command: GitCommand; args: string[] }[] };

describe('the Node git adapter', () => {
  it('runs the host’s prefix and argument shapes, exactly', () => {
    expect(FIXED_PREFIX).toEqual(shapes.prefix);
    for (const { command, args } of shapes.commands) expect(argsOf(command)).toEqual(args);
  });
});
