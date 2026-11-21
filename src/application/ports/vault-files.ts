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
}

/** The file on disk is not the text the caller last saw: someone else wrote it meanwhile. */
export class FileChangedError extends Error {
  override readonly name = 'FileChangedError';
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
  /** Moves a file, never over another ({@link FileExistsError}); a change of case alone is allowed. */
  rename(from: VaultPath, to: VaultPath): Promise<void>;
  /** Moves the file to the Trash (deletes it where there is none). */
  remove(path: VaultPath): Promise<void>;
  /**
   * Hears files change on disk, whoever changed them, in batches once the
   * vault is quiet; never git's own files. Returns the way to stop.
   */
  watch(listener: (paths: readonly VaultPath[]) => void): () => void;
}
