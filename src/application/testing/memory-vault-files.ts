import { foldedPath, isTextFile, type VaultPath } from '../../domain/vault/index.ts';
import {
  FileChangedError,
  FileExistsError,
  type VaultFiles,
  type VaultSnapshot,
} from '../ports/index.ts';

const byPath = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * A vault folder held in memory, with the same guards as the disk: the
 * tests' vault, and the app's in a browser (the sample vault). `edit` and
 * `drop` stand for another program changing the folder; the watcher hears them.
 */
export class MemoryVaultFiles implements VaultFiles {
  private readonly texts = new Map<VaultPath, string>();
  private readonly others = new Set<VaultPath>();
  private readonly listeners = new Set<(paths: readonly VaultPath[]) => void>();
  /** What was moved to the Trash, newest last. */
  readonly trashed: VaultPath[] = [];

  /** A folder holding these files: `{ path: text }`, and paths of files that are not text. */
  static of(
    texts: Readonly<Record<VaultPath, string>>,
    otherPaths: readonly VaultPath[] = [],
  ): MemoryVaultFiles {
    const files = new MemoryVaultFiles();
    for (const [path, text] of Object.entries(texts)) files.texts.set(path, text);
    for (const path of otherPaths) files.others.add(path);
    return files;
  }

  /** The text at `path` now, as a test reads the folder. */
  peek(path: VaultPath): string | undefined {
    return this.texts.get(path);
  }

  /** Another program writes the file. */
  edit(path: VaultPath, text: string): void {
    this.texts.set(path, text);
    this.announce([path]);
  }

  /** Another program deletes the file. */
  drop(path: VaultPath): void {
    this.texts.delete(path);
    this.announce([path]);
  }

  async readAll(): Promise<VaultSnapshot> {
    const paths = [...this.texts.keys()].sort(byPath);
    return {
      notes: paths.map((path) => ({ path, text: this.texts.get(path) ?? '' })),
      otherPaths: [...this.others].sort(byPath),
    };
  }

  async read(path: VaultPath): Promise<string | null> {
    return isTextFile(path) ? (this.texts.get(path) ?? null) : null;
  }

  async write({
    path,
    text,
    expected,
  }: {
    path: VaultPath;
    text: string;
    expected: string | null;
  }): Promise<void> {
    const current = this.texts.get(path) ?? null;
    if (expected === null && this.isTaken(path)) throw new FileExistsError(`${path} exists.`);
    if (expected !== null && current !== expected) throw new FileChangedError(`${path} changed.`);
    this.texts.set(path, text);
  }

  async rename(from: VaultPath, to: VaultPath): Promise<void> {
    const text = this.texts.get(from);
    if (text === undefined) throw new Error(`There is no file at ${from}.`);
    if (foldedPath(from) !== foldedPath(to) && this.isTaken(to)) {
      throw new FileExistsError(`${to} exists.`);
    }
    this.texts.delete(from);
    this.texts.set(to, text);
  }

  async remove(path: VaultPath): Promise<void> {
    if (this.texts.delete(path) || this.others.delete(path)) this.trashed.push(path);
  }

  watch(listener: (paths: readonly VaultPath[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Taken case aside, as on a Mac's disk. */
  private isTaken(path: VaultPath): boolean {
    const wanted = foldedPath(path);
    return [...this.texts.keys(), ...this.others].some((other) => foldedPath(other) === wanted);
  }

  private announce(paths: readonly VaultPath[]): void {
    for (const listener of this.listeners) listener(paths);
  }
}
