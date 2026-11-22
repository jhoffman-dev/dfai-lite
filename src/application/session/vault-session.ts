import {
  FAVORITES_PATH,
  parseFavorites,
  type Favorites,
  type ParsedFavorites,
} from '../../domain/favorites/index.ts';
import { VaultIndex } from '../../domain/index/index.ts';
import {
  buildFolderTree,
  foldersAbove,
  isWithin,
  joinPath,
  KEEP_FILE,
  pathAfterMove,
  type FolderNode,
  type PathMove,
  type VaultPath,
} from '../../domain/vault/index.ts';
import type { StoredFile } from '../ports/index.ts';

/** What changed in the session; listeners re-read what they show. */
export type VaultChange =
  | { readonly kind: 'loaded' }
  /** A file was created, or its text changed. */
  | { readonly kind: 'written'; readonly path: VaultPath }
  | { readonly kind: 'deleted'; readonly path: VaultPath }
  | { readonly kind: 'renamed'; readonly from: VaultPath; readonly to: VaultPath }
  /** A folder was made or removed. */
  | { readonly kind: 'folders' }
  /** A file that is not text (a picture) was added, replaced or removed. */
  | { readonly kind: 'file'; readonly path: VaultPath };

export type VaultListener = (change: VaultChange) => void;

/** The index's questions, without its mutators: only the session changes the index. */
export type VaultIndexView = Pick<
  VaultIndex,
  | 'has'
  | 'paths'
  | 'resolve'
  | 'summary'
  | 'outgoing'
  | 'backlinks'
  | 'linkSources'
  | 'unresolved'
  | 'tagsOf'
  | 'notesWithTag'
  | 'tagCounts'
  | 'tagTree'
  | 'graph'
>;

const NO_FAVORITES: ParsedFavorites = { kind: 'ok', favorites: [] };

/**
 * The open vault in memory: every file's text, the derived index, and the
 * favorites, kept in step and announced to listeners. The UI's store
 * subscribes here; nothing here knows about React.
 *
 * Use-cases change it (`apply…`) after the disk has the change, so the
 * session never shows what the Mac has not kept. `version` grows by one
 * with every change, for snapshot-based subscribers.
 */
export class VaultSession {
  private files = new Map<VaultPath, StoredFile>();
  private others: readonly VaultPath[] = [];
  private folderSet = new Set<VaultPath>();
  private vaultIndex = new VaultIndex();
  private parsedFavorites: ParsedFavorites = NO_FAVORITES;
  private tree: FolderNode | null = null;
  private readonly listeners = new Set<VaultListener>();
  private changes = 0;

  get version(): number {
    return this.changes;
  }

  get index(): VaultIndexView {
    return this.vaultIndex;
  }

  /** The favorite notes, in order. Empty when the file is missing or malformed. */
  get favorites(): Favorites {
    return this.parsedFavorites.favorites;
  }

  /** Why the favorites file could not be read, or null when it could (or does not exist). */
  get favoritesProblem(): string | null {
    return this.parsedFavorites.kind === 'malformed' ? this.parsedFavorites.reason : null;
  }

  file(path: VaultPath): StoredFile | null {
    return this.files.get(path) ?? null;
  }

  /** Every file held, notes and app files alike, in no set order. */
  allFiles(): IterableIterator<StoredFile> {
    return this.files.values();
  }

  /** The visible notes and folders as a tree, rebuilt only when the set of paths changes. */
  folderTree(): FolderNode {
    this.tree ??= buildFolderTree(this.vaultIndex.paths(), this.folderSet);
    return this.tree;
  }

  /** Every folder on disk, empty or not, in no set order. */
  folders(): readonly VaultPath[] {
    return [...this.folderSet];
  }

  subscribe(listener: VaultListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The vault's files that are not read as text (images, PDFs), as last loaded. */
  otherPaths(): readonly VaultPath[] {
    return this.others;
  }

  /** Every path in the vault, text files and the rest: what a new file's name must not take. */
  takenPaths(): VaultPath[] {
    return [...this.files.keys(), ...this.others];
  }

  /** `otherPaths`: the vault's files that are not read as text (images, PDFs); `folders`: every folder. */
  load(
    files: Iterable<StoredFile>,
    otherPaths: readonly VaultPath[] = [],
    folders: readonly VaultPath[] = [],
  ): void {
    this.others = otherPaths;
    this.folderSet = new Set(folders);
    this.files = new Map();
    for (const file of files) this.files.set(file.path, file);
    this.vaultIndex = VaultIndex.build(this.files.values());
    this.parsedFavorites = readFavorites(this.files.get(FAVORITES_PATH));
    this.tree = null;
    this.emit({ kind: 'loaded' });
  }

  applyWrite(file: StoredFile): void {
    const isNew = !this.files.has(file.path);
    this.files.set(file.path, file);
    this.vaultIndex.upsert(file.path, file.text);
    if (file.path === FAVORITES_PATH) this.parsedFavorites = readFavorites(file);
    if (isNew) {
      this.addFoldersAbove(file.path);
      this.tree = null;
    }
    this.emit({ kind: 'written', path: file.path });
  }

  applyDelete(path: VaultPath): void {
    if (!this.files.delete(path)) return;
    this.vaultIndex.remove(path);
    if (path === FAVORITES_PATH) this.parsedFavorites = NO_FAVORITES;
    this.tree = null;
    this.emit({ kind: 'deleted', path });
  }

  /** `from` is now `to`; `to` carries the file as the store now holds it. */
  applyRename(from: VaultPath, to: StoredFile): void {
    this.files.delete(from);
    this.files.set(to.path, to);
    // `to` may carry new text as well as a new path, so it is read afresh.
    this.vaultIndex.remove(from);
    this.vaultIndex.upsert(to.path, to.text);
    // The folder moved from stays on disk, emptied; the one moved to is there now.
    this.addFoldersAbove(to.path);
    this.tree = null;
    this.emit({ kind: 'renamed', from, to: to.path });
  }

  /**
   * A folder moved on disk with everything in it: each file under it is at
   * its new path (one `renamed` per file, so what shows a note follows it),
   * and so are the files not read as text and the folders under it.
   */
  applyFolderMove(move: PathMove): void {
    const moved = [...this.files.values()].filter((file) => isWithin(file.path, move.from));
    for (const file of moved) {
      const to = pathAfterMove(file.path, move) ?? file.path;
      this.files.delete(file.path);
      this.files.set(to, { path: to, text: file.text });
      this.vaultIndex.remove(file.path);
      this.vaultIndex.upsert(to, file.text);
    }
    const follow = (path: VaultPath) => pathAfterMove(path, move) ?? path;
    this.others = this.others.map(follow).sort();
    this.folderSet = new Set([...this.folderSet].map(follow));
    this.addFoldersAbove(joinPath(move.to, KEEP_FILE));
    this.tree = null;
    for (const file of moved) {
      this.emit({ kind: 'renamed', from: file.path, to: follow(file.path) });
    }
    this.emit({ kind: 'folders' });
  }

  /**
   * A file that is not text (a picture) is on disk at `path` now, new or
   * replaced, or is gone (`present` false). The vault is not read again: the
   * notes and their index are as they were.
   */
  applyOtherFile(path: VaultPath, present: boolean): void {
    const listed = this.others.includes(path);
    if (present && !listed) this.others = [...this.others, path].sort();
    if (!present) this.others = this.others.filter((other) => other !== path);
    const folders = this.folderSet.size;
    if (present) this.addFoldersAbove(path);
    if (this.folderSet.size !== folders) this.tree = null;
    if (present || listed) this.emit({ kind: 'file', path });
  }

  /** The folder (and any above it) was made on disk, with its keep file. */
  applyCreateFolder(path: VaultPath): void {
    this.folderSet.add(path);
    this.addFoldersAbove(path);
    this.others = [...this.others, joinPath(path, KEEP_FILE)].sort();
    this.tree = null;
    this.emit({ kind: 'folders' });
  }

  /** The folder was removed from disk, with the disposable files it held. */
  applyRemoveFolder(path: VaultPath): void {
    this.folderSet.delete(path);
    this.others = this.others.filter((other) => !isWithin(other, path));
    this.tree = null;
    this.emit({ kind: 'folders' });
  }

  private addFoldersAbove(path: VaultPath): void {
    for (const folder of foldersAbove(path)) this.folderSet.add(folder);
  }

  private emit(change: VaultChange): void {
    this.changes += 1;
    for (const listener of this.listeners) listener(change);
  }
}

function readFavorites(file: StoredFile | undefined): ParsedFavorites {
  return file === undefined ? NO_FAVORITES : parseFavorites(file.text);
}
