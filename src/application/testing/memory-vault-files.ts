import {
  foldedPath,
  foldersAbove,
  isDisposableFile,
  isTextFile,
  isWithin,
  joinPath,
  KEEP_FILE,
  type VaultPath,
} from '../../domain/vault/index.ts';
import {
  FileChangedError,
  FileExistsError,
  TrashRefusedError,
  type Unsyncable,
  type VaultFiles,
  type VaultSnapshot,
} from '../ports/index.ts';

const byPath = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** The host's ceiling on a file read or written as bytes (`src-tauri/src/binary.rs`). */
const MAX_BINARY_BYTES = 32 * 1024 * 1024;

/**
 * A vault folder held in memory, with the same guards as the disk: the
 * tests' vault, and the app's in a browser (the sample vault). `edit` and
 * `drop` stand for another program changing the folder; the watcher hears them.
 */
export class MemoryVaultFiles implements VaultFiles {
  private readonly texts = new Map<VaultPath, string>();
  private readonly others = new Set<VaultPath>();
  /** The bytes of the files that are not text; one listed without any holds none. */
  private readonly bytes = new Map<VaultPath, Uint8Array>();
  /** Folders kept though nothing is in them; a folder holding a file needs no entry. */
  private readonly emptyFolders = new Set<VaultPath>();
  private readonly listeners = new Set<(paths: readonly VaultPath[]) => void>();
  /** What was moved to the Trash, newest last. */
  readonly trashed: VaultPath[] = [];
  /** Set to stand for a Trash that refuses (a volume with none). */
  trashRefuses = false;
  private ignoreText: string | null = null;

  /**
   * A folder holding these files: `{ path: text }`, paths of files that are
   * not text, empty folders, and `{ path: bytes }` of files that are not text.
   */
  static of(
    texts: Readonly<Record<VaultPath, string>>,
    otherPaths: readonly VaultPath[] = [],
    folders: readonly VaultPath[] = [],
    binaries: Readonly<Record<VaultPath, Uint8Array>> = {},
  ): MemoryVaultFiles {
    const files = new MemoryVaultFiles();
    for (const [path, text] of Object.entries(texts)) files.texts.set(path, text);
    for (const path of otherPaths) files.others.add(path);
    for (const path of folders) files.emptyFolders.add(path);
    for (const [path, bytes] of Object.entries(binaries)) {
      files.others.add(path);
      files.bytes.set(path, bytes);
    }
    return files;
  }

  /** The bytes at `path` now, as a test reads the folder. */
  peekBinary(path: VaultPath): Uint8Array | undefined {
    return this.bytes.get(path);
  }

  /** Another program adds or replaces a file that is not text. */
  editBinary(path: VaultPath, bytes: Uint8Array): void {
    this.others.add(path);
    this.bytes.set(path, bytes);
    this.announce([path]);
  }

  /** Every folder: the ones kept empty, and every one a file is in. */
  folders(): VaultPath[] {
    const all = new Set(this.emptyFolders);
    for (const path of [...this.texts.keys(), ...this.others]) {
      for (const folder of foldersAbove(path)) all.add(folder);
    }
    return [...all].sort(byPath);
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
      folders: this.folders(),
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

  async readBinary(path: VaultPath): Promise<Uint8Array | null> {
    const text = this.texts.get(path);
    if (text !== undefined) return new TextEncoder().encode(text);
    if (!this.others.has(path)) return null;
    const bytes = this.bytes.get(path) ?? new Uint8Array();
    if (bytes.length > MAX_BINARY_BYTES) throw new Error(`${path} is over 32 MB.`);
    return bytes;
  }

  async writeBinary({ path, bytes }: { path: VaultPath; bytes: Uint8Array }): Promise<void> {
    if (this.isTaken(path)) throw new FileExistsError(`${path} exists.`);
    if (bytes.length > MAX_BINARY_BYTES) throw new Error(`${path} is over 32 MB.`);
    this.others.add(path);
    this.bytes.set(path, bytes);
  }

  async rename(from: VaultPath, to: VaultPath): Promise<void> {
    const text = this.texts.get(from);
    if (text === undefined) throw new Error(`There is no file at ${from}.`);
    if (foldedPath(from) !== foldedPath(to) && this.isTaken(to)) {
      throw new FileExistsError(`${to} exists.`);
    }
    // As on disk, the folder moved from stays, emptied.
    this.keepFoldersAbove(from);
    this.texts.delete(from);
    this.texts.set(to, text);
  }

  async createFolder(path: VaultPath): Promise<void> {
    const wanted = foldedPath(path);
    if (this.isTaken(path) || this.folders().some((folder) => foldedPath(folder) === wanted)) {
      throw new FileExistsError(`${path} exists.`);
    }
    this.others.add(joinPath(path, KEEP_FILE));
  }

  /** As on a Mac's disk: the folder is found case aside, and a change of case alone is allowed. */
  async renameFolder(from: VaultPath, to: VaultPath): Promise<void> {
    const within = (path: VaultPath, folder: VaultPath) =>
      isWithin(foldedPath(path), foldedPath(folder));
    if (!this.folders().some((folder) => foldedPath(folder) === foldedPath(from))) {
      throw new Error(`There is no folder at ${from}.`);
    }
    const sameFolder = foldedPath(from) === foldedPath(to);
    const all = [...this.texts.keys(), ...this.others, ...this.folders()];
    if (!sameFolder && all.some((path) => within(path, to))) {
      throw new FileExistsError(`${to} exists.`);
    }
    const follow = (path: VaultPath) =>
      within(path, from) ? `${to}${path.slice(from.length)}` : path;
    for (const [path, text] of [...this.texts]) {
      this.texts.delete(path);
      this.texts.set(follow(path), text);
    }
    for (const set of [this.others, this.emptyFolders]) {
      const moved = [...set].map(follow);
      set.clear();
      for (const path of moved) set.add(path);
    }
    for (const [path, bytes] of [...this.bytes]) {
      this.bytes.delete(path);
      this.bytes.set(follow(path), bytes);
    }
    this.keepFoldersAbove(joinPath(to, KEEP_FILE));
    this.emptyFolders.add(to);
  }

  async removeFolder(path: VaultPath): Promise<void> {
    const inside = (other: VaultPath) => other !== path && isWithin(other, path);
    const files = [...this.texts.keys(), ...this.others].filter(inside);
    const folders = this.folders().filter(inside);
    if (!this.folders().includes(path)) throw new Error(`There is no folder at ${path}.`);
    if (folders.length > 0 || !files.every(isDisposableFile)) {
      throw new Error(`${path} is not empty.`);
    }
    for (const file of files) {
      this.others.delete(file);
      this.bytes.delete(file);
    }
    this.emptyFolders.delete(path);
  }

  async remove({
    path,
    expected,
    permanently,
  }: {
    path: VaultPath;
    expected: string | null;
    permanently: boolean;
  }): Promise<void> {
    if (expected !== null && this.texts.get(path) !== expected) {
      throw new FileChangedError(`${path} changed.`);
    }
    if (!permanently && this.trashRefuses) throw new TrashRefusedError(`No Trash for ${path}.`);
    this.keepFoldersAbove(path);
    this.bytes.delete(path);
    const removed = this.texts.delete(path) || this.others.delete(path);
    if (removed && !permanently) this.trashed.push(path);
  }

  async readIgnoreFile(): Promise<string | null> {
    return this.ignoreText;
  }

  async writeIgnoreFile({ text, expected }: { text: string; expected: string | null }) {
    if (this.ignoreText !== expected) throw new FileChangedError('.gitignore changed.');
    this.ignoreText = text;
  }

  async findUnsyncable(): Promise<Unsyncable> {
    return { tooLarge: [], nestedRepos: [] };
  }

  watch(listener: (paths: readonly VaultPath[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private keepFoldersAbove(path: VaultPath): void {
    for (const folder of foldersAbove(path)) this.emptyFolders.add(folder);
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
