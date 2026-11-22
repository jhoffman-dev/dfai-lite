import type { VaultPath } from '../../domain/vault/index.ts';

/**
 * One vault file the app reads as text: a note, or one of the app's own
 * synced files (`.dfai-lite/favorites.json`).
 */
export interface StoredFile {
  readonly path: VaultPath;
  readonly text: string;
}

/** The whole vault, read in one call. */
export interface VaultSnapshot {
  /** Every text file with its text, sorted by path. */
  readonly notes: readonly StoredFile[];
  /** Every other file (an image, a PDF), by path only. */
  readonly otherPaths: readonly VaultPath[];
  /** Every folder, empty or not, by path, sorted; the walk skips what it skips for files. */
  readonly folders: readonly VaultPath[];
}

/** The file on disk is not the text the caller last saw: someone else wrote it meanwhile. */
export class FileChangedError extends Error {
  override readonly name = 'FileChangedError';
}

/** The Trash would not take the file. Nothing was deleted; deleting for good is the person's call. */
export class TrashRefusedError extends Error {
  override readonly name = 'TrashRefusedError';
}

/** What `git add --all` must not be given. */
export interface Unsyncable {
  /** Files over GitHub's 100 MB limit: a push holding one is refused, every time. */
  readonly tooLarge: readonly VaultPath[];
  /** Folders that are git repositories of their own. */
  readonly nestedRepos: readonly VaultPath[];
}

/** A file is already at the path a create or a move wanted. */
export class FileExistsError extends Error {
  override readonly name = 'FileExistsError';
}

/**
 * The vault's folder on this Mac (the Rust host in the app, memory in the
 * browser and tests). Paths are vault paths, `/`-separated; the adapter
 * refuses any that would leave the vault. It decides nothing.
 */
export interface VaultFiles {
  /** Every file, in one call: fast enough for 2,000 notes at start. */
  readAll(): Promise<VaultSnapshot>;
  /** The file's text, or null when there is none. */
  read(path: VaultPath): Promise<string | null>;
  /**
   * Writes `text` at `path` only while the file still holds `expected`;
   * with `expected` null, only when no file is there yet. Rejects with
   * {@link FileChangedError} or {@link FileExistsError} otherwise.
   */
  write(request: {
    readonly path: VaultPath;
    readonly text: string;
    readonly expected: string | null;
  }): Promise<void>;
  /**
   * A file's bytes — a note's picture — or null when there is none. Rejects
   * for a file over the host's ceiling (32 MiB) or one it cannot read.
   */
  readBinary(path: VaultPath): Promise<Uint8Array | null>;
  /**
   * Writes `bytes` as a new file, the folders above it made as needed, never
   * over a file already there ({@link FileExistsError}).
   */
  writeBinary(request: { readonly path: VaultPath; readonly bytes: Uint8Array }): Promise<void>;
  /** Moves a file, never over another ({@link FileExistsError}); a change of case alone is allowed. */
  rename(from: VaultPath, to: VaultPath): Promise<void>;
  /**
   * Makes a folder (and any missing above it) holding an empty `.gitkeep`
   * (`KEEP_FILE`), so git carries it while it is empty. Rejects with
   * {@link FileExistsError} when a file or folder is at the path, case aside.
   */
  createFolder(path: VaultPath): Promise<void>;
  /**
   * Removes a folder that holds nothing but disposable files (its
   * `.gitkeep`, Finder's `.DS_Store`); rejects, removing nothing, otherwise.
   */
  removeFolder(path: VaultPath): Promise<void>;
  /**
   * Moves a folder, everything in it included, in one step; never onto
   * another folder or file ({@link FileExistsError}). A change of case alone
   * is the same folder on a Mac's disk, and its case really changes.
   */
  renameFolder(from: VaultPath, to: VaultPath): Promise<void>;
  /**
   * Moves the file to the Trash, or deletes it for good when `permanently`,
   * only while it holds `expected` (null: whatever it holds). Rejects with
   * {@link FileChangedError}, or {@link TrashRefusedError} when the Trash
   * would not take it.
   */
  remove(request: {
    readonly path: VaultPath;
    readonly expected: string | null;
    readonly permanently: boolean;
  }): Promise<void>;
  /** The vault's top `.gitignore`, or null; the one dot file the app writes. */
  readIgnoreFile(): Promise<string | null>;
  /** Writes the `.gitignore` with the same guard as {@link write}. */
  writeIgnoreFile(request: {
    readonly text: string;
    readonly expected: string | null;
  }): Promise<void>;
  /** Files and folders `git add --all` must not be given. */
  findUnsyncable(): Promise<Unsyncable>;
  /**
   * Hears files change on disk, whoever changed them, in batches once the
   * vault is quiet; never git's own files. Returns the way to stop.
   */
  watch(listener: (paths: readonly VaultPath[]) => void): () => void;
}
