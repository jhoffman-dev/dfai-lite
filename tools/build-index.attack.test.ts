// Attacks on the index writer: it may only ever change files inside `_index/`.
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildIndex } from './build-index.ts';

let root: string;

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lite-index-attack-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('buildIndex under attack', () => {
  it('never deletes a file outside the vault when `_index` is a symlink', async () => {
    await put('Vault/People/Mara Quill.md', 'Mara leads payroll.\n');
    await put('Elsewhere/Larkspur Payroll budget.md', 'The only copy of the budget.\n');
    await symlink(join(root, 'Elsewhere'), join(root, 'Vault/_index'));
    await buildIndex(join(root, 'Vault')).catch(() => undefined);
    expect(await readFile(join(root, 'Elsewhere/Larkspur Payroll budget.md'), 'utf8')).toBe(
      'The only copy of the budget.\n',
    );
  });
});
