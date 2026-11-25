// File-system helpers the tools share. Plain Node, no dependencies, erasable
// TypeScript only, so `node tools/<tool>.ts` runs them as they are.
import { lstat, mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

/** Folders at a vault's root never read as part of it. */
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules', '_index']);

/** A file found under a folder: its path from that folder, `/`-separated, and where it is on disk. */
export interface FoundFile {
  readonly path: string;
  readonly absolute: string;
}

/** What a walk found and did not follow: a symbolic link, or anything neither file nor folder. */
export interface PassedOver {
  readonly path: string;
  readonly kind: 'symlink' | 'special';
}

const byPath = (left: { path: string }, right: { path: string }): number =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0;

/** Folders left out at a walk's root: their names, or a test of a name. */
export type RootSkip = ReadonlySet<string> | ((name: string) => boolean);

/**
 * Every regular file under `root`, sorted by path, and what was passed over.
 * Symbolic links are never followed. `skip` names folders left out at the
 * root only: a folder of that name deeper down is an ordinary folder.
 */
export async function scanFolder(
  root: string,
  skip: RootSkip = SKIPPED_FOLDERS,
): Promise<{ files: FoundFile[]; passedOver: PassedOver[] }> {
  const skipped = typeof skip === 'function' ? skip : (name: string) => skip.has(name);
  const files: FoundFile[] = [];
  const passedOver: PassedOver[] = [];
  const walk = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(folder, entry.name);
      const path = relative(root, absolute).split(sep).join('/');
      if (entry.isDirectory()) {
        if (!(folder === root && skipped(entry.name))) await walk(absolute);
      } else if (entry.isFile()) {
        files.push({ path, absolute });
      } else {
        passedOver.push({ path, kind: entry.isSymbolicLink() ? 'symlink' : 'special' });
      }
    }
  };
  await walk(root);
  return { files: files.sort(byPath), passedOver: passedOver.sort(byPath) };
}

/** Every regular file under `root`, sorted by path, skipping the `skip` folders at the root. */
export async function listFiles(
  root: string,
  skip: RootSkip = SKIPPED_FOLDERS,
): Promise<FoundFile[]> {
  return (await scanFolder(root, skip)).files;
}

/**
 * Every markdown file under `root` with its text, leaving out dot folders
 * unread: the index ignores them, and the Action checks the writer out into one.
 * Read one at a time, so a vault of any size never runs out of file handles.
 */
export async function readMarkdown(root: string): Promise<{ path: string; text: string }[]> {
  const files = (await listFiles(root)).filter(
    ({ path }) =>
      path.toLowerCase().endsWith('.md') && !path.split('/').some((part) => part.startsWith('.')),
  );
  const notes: { path: string; text: string }[] = [];
  for (const { path, absolute } of files)
    notes.push({ path, text: await readFile(absolute, 'utf8') });
  return notes;
}

/** Refused: a write or delete would have gone through a symbolic link, out of the folder it was meant for. */
export class UnsafePathRefused extends Error {
  override readonly name = 'UnsafePathRefused';
}

/** Throws unless each existing part of `root/path` below `root` is a real folder (or, last, a real file). */
export async function assertNoLinks(root: string, path: string): Promise<void> {
  const parts = path.split('/');
  for (let at = 1; at <= parts.length; at += 1) {
    const inside = parts.slice(0, at).join('/');
    const found = await lstat(join(root, ...parts.slice(0, at))).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      },
    );
    if (found === null) return;
    if (found.isSymbolicLink()) {
      throw new UnsafePathRefused(`Refusing to go through a symbolic link: ${inside}`);
    }
    if (at < parts.length && !found.isDirectory()) {
      throw new UnsafePathRefused(`Refusing to write: ${inside} is not a folder`);
    }
  }
}

/** Writes `text` to `root/path`, making its folders; false when the file already held exactly that. Never through a link. */
export async function writeIfChanged(root: string, path: string, text: string): Promise<boolean> {
  await assertNoLinks(root, path);
  const absolute = join(root, ...path.split('/'));
  const current = await readFile(absolute, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (current === text) return false;
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, text, 'utf8');
  return true;
}

/** Deletes `root/path`, then each folder it leaves empty, up to (not including) `stopAt`. Never through a link. */
export async function removeFile(root: string, path: string, stopAt: string): Promise<void> {
  await assertNoLinks(root, path);
  await rm(join(root, ...path.split('/')));
  let folder = dirname(path);
  while (folder !== '.' && folder !== stopAt) {
    const left = await readdir(join(root, ...folder.split('/')));
    if (left.length > 0) return;
    await rmdir(join(root, ...folder.split('/')));
    folder = dirname(folder);
  }
}

/**
 * Changes `root/path` by `change` (null: no file yet) and writes it, making its
 * folders; false when nothing changed. Guarded as far as Node allows: the file
 * is read again just before the write and the change made afresh if another
 * program wrote it meanwhile, and a new file is only ever created, never
 * written over. Never through a link.
 */
export async function changeFile(
  root: string,
  path: string,
  change: (text: string | null) => string,
): Promise<boolean> {
  await assertNoLinks(root, path);
  const absolute = join(root, ...path.split('/'));
  const read = () =>
    readFile(absolute, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await read();
    const next = change(current);
    if (next === current) return false;
    if ((await read()) !== current) continue;
    await mkdir(dirname(absolute), { recursive: true });
    try {
      await writeFile(absolute, next, { encoding: 'utf8', flag: current === null ? 'wx' : 'w' });
      return true;
    } catch (error) {
      // Created by another program since it was read: make the change to that file.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`${path} kept changing while it was written.`);
}
