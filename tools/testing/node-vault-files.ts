// A vault folder on disk through Node, for the real-git sync tests: the
// same port and guards as the Rust host (src-tauri/src/vault.rs), test-only.
import { link, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  FileChangedError,
  FileExistsError,
  type StoredFile,
  type Unsyncable,
  type VaultFiles,
  type VaultSnapshot,
} from '../../src/application/index.ts';

const APP_FOLDER = '.dfai-lite';
const TOO_LARGE_BYTES = 100 * 1024 * 1024;

const skippedFolder = (name: string) =>
  name === 'node_modules' || (name.startsWith('.') && name !== APP_FOLDER);

const isText = (path: string) =>
  /\.md$/i.test(path) || (path.startsWith(`${APP_FOLDER}/`) && /\.json$/i.test(path));

function onDisk(root: string, path: string): string {
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${path} is not a path inside the vault`);
  }
  return join(root, ...path.split('/'));
}

async function textAt(absolute: string): Promise<string | null> {
  try {
    return await readFile(absolute, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class NodeVaultFiles implements VaultFiles {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async readAll(): Promise<VaultSnapshot> {
    const notes: StoredFile[] = [];
    const otherPaths: string[] = [];
    const walk = async (folder: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = `${prefix}${entry.name}`;
        if (entry.isDirectory() && !skippedFolder(entry.name)) {
          await walk(join(folder, entry.name), `${path}/`);
        } else if (entry.isFile()) {
          if (isText(path))
            notes.push({ path, text: await readFile(join(folder, entry.name), 'utf8') });
          else otherPaths.push(path);
        }
      }
    };
    await walk(this.root, '');
    const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return {
      notes: notes.sort((a, b) => byPath(a.path, b.path)),
      otherPaths: otherPaths.sort(byPath),
    };
  }

  read(path: string): Promise<string | null> {
    return textAt(onDisk(this.root, path));
  }

  async write({
    path,
    text,
    expected,
  }: {
    path: string;
    text: string;
    expected: string | null;
  }): Promise<void> {
    const absolute = onDisk(this.root, path);
    const current = await textAt(absolute);
    if (expected === null && current !== null) throw new FileExistsError(`${path} exists`);
    if (expected !== null && current !== expected) throw new FileChangedError(`${path} changed`);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, text, { flag: expected === null ? 'wx' : 'w' });
  }

  async rename(from: string, to: string): Promise<void> {
    const source = onDisk(this.root, from);
    const target = onDisk(this.root, to);
    await mkdir(dirname(target), { recursive: true });
    if (from.toLowerCase() === to.toLowerCase()) {
      await rename(source, target);
      return;
    }
    // As the host on Linux: a link refuses a taken name, then the old name goes.
    await link(source, target).catch((error: NodeJS.ErrnoException) => {
      throw error.code === 'EEXIST' ? new FileExistsError(`${to} exists`) : error;
    });
    await rm(source);
  }

  async remove({
    path,
    expected,
  }: {
    path: string;
    expected: string | null;
    permanently: boolean;
  }) {
    const absolute = onDisk(this.root, path);
    if (expected !== null && (await textAt(absolute)) !== expected) {
      throw new FileChangedError(`${path} changed`);
    }
    // No Trash in the tests: every delete is for good.
    await rm(absolute);
  }

  readIgnoreFile(): Promise<string | null> {
    return textAt(join(this.root, '.gitignore'));
  }

  async writeIgnoreFile({ text, expected }: { text: string; expected: string | null }) {
    const absolute = join(this.root, '.gitignore');
    if ((await textAt(absolute)) !== expected) throw new FileChangedError('.gitignore changed');
    await writeFile(absolute, text);
  }

  async findUnsyncable(): Promise<Unsyncable> {
    const tooLarge: string[] = [];
    const nestedRepos: string[] = [];
    const scan = async (folder: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = `${prefix}${entry.name}`;
        const absolute = join(folder, entry.name);
        if (entry.isDirectory()) {
          if (path === '.git') continue;
          const isRepo = await lstat(join(absolute, '.git')).then(
            () => true,
            () => false,
          );
          if (isRepo) nestedRepos.push(path);
          else await scan(absolute, `${path}/`);
        } else if (entry.isFile() && (await lstat(absolute)).size > TOO_LARGE_BYTES) {
          tooLarge.push(path);
        }
      }
    };
    await scan(this.root, '');
    return { tooLarge: tooLarge.sort(), nestedRepos: nestedRepos.sort() };
  }

  watch(): () => void {
    // The tests bring the session in step themselves; nothing watches here.
    return () => undefined;
  }
}
