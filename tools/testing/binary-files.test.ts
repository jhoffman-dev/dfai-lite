import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExistsError, type VaultFiles } from '../../src/application/index.ts';
import { MemoryVaultFiles } from '../../src/application/testing/index.ts';
import { NodeVaultFiles } from './node-vault-files.ts';

/*
 * The binary half of the vault port, as the Rust host keeps it
 * (`src-tauri/src/binary.rs`): bytes round-trip, a new file never lands on
 * one already there, a missing file reads as null, and nothing past the
 * 32 MiB ceiling is written. The same cases run against both test adapters.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 7]);
const OVER_CEILING = new Uint8Array(32 * 1024 * 1024 + 1);

let root = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dfai-lite-binary-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const adapters: [name: string, make: () => VaultFiles][] = [
  ['memory', () => MemoryVaultFiles.of({ 'a.md': 'text' })],
  ['node', () => new NodeVaultFiles(root)],
];

describe.each(adapters)('the %s vault’s pictures', (_name, make) => {
  it('read back the bytes written, in a folder made for them', async () => {
    const files = make();
    await files.writeBinary({ path: 'attachments/a b.png', bytes: PNG });
    expect(await files.readBinary('attachments/a b.png')).toEqual(PNG);
    expect((await files.readAll()).otherPaths).toContain('attachments/a b.png');
  });

  it('never write over a file already there', async () => {
    const files = make();
    await files.writeBinary({ path: 'p.png', bytes: PNG });
    await expect(
      files.writeBinary({ path: 'p.png', bytes: new Uint8Array([1]) }),
    ).rejects.toBeInstanceOf(FileExistsError);
    expect(await files.readBinary('p.png')).toEqual(PNG);
  });

  it('are looked for without being read', async () => {
    const files = make();
    await files.writeBinary({ path: 'attachments/a.png', bytes: PNG });
    expect(await files.exists('attachments/a.png')).toBe(true);
    expect(await files.exists('attachments/none.png')).toBe(false);
  });

  it('read a missing file as null', async () => {
    expect(await make().readBinary('none.png')).toBeNull();
  });

  it('refuse a file past the ceiling', async () => {
    const files = make();
    await expect(files.writeBinary({ path: 'big.png', bytes: OVER_CEILING })).rejects.toThrow(
      /32 MB/,
    );
    expect(await files.readBinary('big.png')).toBeNull();
  });
});

describe('the Node vault’s pictures, on disk', () => {
  it('refuse a path out of the vault', async () => {
    const files = new NodeVaultFiles(root);
    await expect(files.writeBinary({ path: '../x.png', bytes: PNG })).rejects.toThrow(
      /not a path inside the vault/,
    );
  });

  it('refuse to write through a link planted at the name', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dfai-lite-outside-'));
    await mkdir(join(root, 'attachments'));
    await symlink(join(outside, 'new.png'), join(root, 'attachments', 'a.png'));
    const files = new NodeVaultFiles(root);
    await expect(files.writeBinary({ path: 'attachments/a.png', bytes: PNG })).rejects.toThrow();
    await expect(readFile(join(outside, 'new.png'))).rejects.toThrow();
    await rm(outside, { recursive: true, force: true });
  });

  it('read a file another program wrote', async () => {
    await writeFile(join(root, 'shot.png'), PNG);
    expect(await new NodeVaultFiles(root).readBinary('shot.png')).toEqual(PNG);
  });
});
