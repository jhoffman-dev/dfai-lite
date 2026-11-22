import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The editor's markdown writer (src/adapters/markdown/emphasis-handlers.ts,
 * strikethrough-handler.ts) is written against mdast-util-to-markdown 2.1:
 * 2.2 rewrote how emphasis encodes the characters beside it, and the
 * handlers no longer type-check or write the same bytes. pnpm-workspace.yaml
 * pins it; this fails the moment anything resolves another version.
 */

const PINNED = '2.1.2';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The version of `mdast-util-to-markdown` that code in `from` gets when it imports it. */
function versionSeenFrom(from: string): string {
  const entry = createRequire(from).resolve('mdast-util-to-markdown');
  const manifest = join(dirname(entry), 'package.json');
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

describe('the markdown writer’s version', () => {
  it('is the pinned one, for the adapter’s own handlers', () => {
    expect(versionSeenFrom(join(root, 'src/adapters/markdown/emphasis-handlers.ts'))).toBe(PINNED);
  });

  it('is the pinned one for remark-stringify, which writes every block with it', () => {
    const remarkStringify = createRequire(
      join(root, 'src/adapters/markdown/markdown-blocks.ts'),
    ).resolve('remark-stringify');
    const writer = createRequire(remarkStringify).resolve('mdast-util-to-markdown');
    expect(versionSeenFrom(writer)).toBe(PINNED);
  });

  it('is what pnpm-workspace.yaml and package.json say', () => {
    const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain(`mdast-util-to-markdown: ${PINNED}`);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['mdast-util-to-markdown']).toBe(PINNED);
  });
});
