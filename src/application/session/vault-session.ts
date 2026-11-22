import {
  CALLOUTS_PATH,
  NO_CALLOUT_SETTINGS,
  isCalloutsConflictCopy,
  mergeCalloutSettings,
  parseCalloutSettings,
  type CalloutSettings,
} from '../../domain/callouts/index.ts';
import {
  FAVORITES_PATH,
  parseFavorites,
  type Favorites,
  type ParsedFavorites,
} from '../../domain/favorites/index.ts';
import {
  APPEARANCE_PATH,
  parseAppearances,
  resolveAppearance,
  type Appearances,
  type ParsedAppearances,
  type ResolvedAppearance,
} from '../../domain/appearance/index.ts';
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
const NO_APPEARANCES: ParsedAppearances = { kind: 'ok', appearances: new Map() };

/** Each path's look as drawn, by path: one map lookup per row. */
export type ResolvedAppearances = ReadonlyMap<VaultPath, ResolvedAppearance>;

/** The vault's callout types as read: the file, with any conflict copy's types merged in. */
interface CalloutsRead {
  readonly settings: CalloutSettings;
  /** Why the file could not be read, or null. */
  readonly problem: string | null;
  /** The other Mac's versions a sync saved beside the file, whose types are merged in. */
  readonly copies: readonly VaultPath[];
}

const NO_CALLOUTS: CalloutsRead = { settings: NO_CALLOUT_SETTINGS, problem: null, copies: [] };

const isCalloutsFile = (path: VaultPath) => path === CALLOUTS_PATH || isCalloutsConflictCopy(path);

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
  private parsedAppearances: ParsedAppearances = NO_APPEARANCES;
  private resolved: ResolvedAppearances = new Map();
  private callouts: CalloutsRead = NO_CALLOUTS;
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

  /** The folders' and notes' looks as the file holds them. Empty when it is missing or malformed. */
  get appearances(): Appearances {
    return this.parsedAppearances.appearances;
  }

  /** Why the appearance file could not be read, or null when it could (or does not exist). */
  get appearancesProblem(): string | null {
    return this.parsedAppearances.kind === 'malformed' ? this.parsedAppearances.reason : null;
  }

  /**
   * Every look as drawn, by path. The map is replaced only when the file
   * changes, and a path whose look did not change keeps the same object, so
   * a row comparing its look by identity re-renders only when its own did.
   */
  get resolvedAppearances(): ResolvedAppearances {
    return this.resolved;
  }

  /**
   * The vault's own callout types and hidden built-ins; the same object
   * until a callouts file changes. Empty when the file is missing or malformed.
   */
  get calloutSettings(): CalloutSettings {
    return this.callouts.settings;
  }

  /** Why the callouts file could not be read, or null when it could (or does not exist). */
  get calloutsProblem(): string | null {
    return this.callouts.problem;
  }

  /** Conflict copies of the callouts file, whose types are merged in until a save folds them in. */
  get calloutCopies(): readonly VaultPath[] {
    return this.callouts.copies;
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
    this.readAppearances(this.files.get(APPEARANCE_PATH));
    this.callouts = readCallouts(this.files);
    this.tree = null;
    this.emit({ kind: 'loaded' });
  }

  applyWrite(file: StoredFile): void {
    const isNew = !this.files.has(file.path);
    this.files.set(file.path, file);
    this.vaultIndex.upsert(file.path, file.text);
    if (file.path === FAVORITES_PATH) this.parsedFavorites = readFavorites(file);
    if (file.path === APPEARANCE_PATH) this.readAppearances(file);
    if (isCalloutsFile(file.path)) this.callouts = readCallouts(this.files);
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
    if (path === APPEARANCE_PATH) this.readAppearances(undefined);
    if (isCalloutsFile(path)) this.callouts = readCallouts(this.files);
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
    if (isCalloutsFile(from) || isCalloutsFile(to.path)) this.callouts = readCallouts(this.files);
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

  private readAppearances(file: StoredFile | undefined): void {
    this.parsedAppearances = file === undefined ? NO_APPEARANCES : parseAppearances(file.text);
    const before = this.resolved;
    const next = new Map<VaultPath, ResolvedAppearance>();
    for (const [path, appearance] of this.parsedAppearances.appearances) {
      const look = resolveAppearance(appearance);
      const held = before.get(path);
      next.set(path, held !== undefined && sameLook(held, look) ? held : look);
    }
    this.resolved = next;
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

function sameLook(left: ResolvedAppearance, right: ResolvedAppearance): boolean {
  const iconKey = (look: ResolvedAppearance) =>
    look.icon === null ? '' : look.icon.kind === 'glyph' ? look.icon.name : look.icon.text;
  return left.hue === right.hue && iconKey(left) === iconKey(right);
}

/**
 * The callouts file, read; a malformed one reads as nothing (and why), and
 * its conflict copies are then left alone too, as nothing is merged into
 * a file that cannot be written.
 */
function readCallouts(files: ReadonlyMap<VaultPath, StoredFile>): CalloutsRead {
  const file = files.get(CALLOUTS_PATH);
  const parsed = file === undefined ? null : parseCalloutSettings(file.text);
  if (parsed?.kind === 'malformed') return { ...NO_CALLOUTS, problem: parsed.reason };
  const copies = [...files.keys()].filter(isCalloutsConflictCopy).sort();
  const copied = copies
    .map((path) => parseCalloutSettings(files.get(path)?.text ?? ''))
    .filter((read) => read.kind === 'ok')
    .map((read) => read.settings);
  const settings = parsed?.settings ?? NO_CALLOUT_SETTINGS;
  return {
    settings: copies.length === 0 ? settings : mergeCalloutSettings(settings, copied),
    problem: null,
    copies,
  };
}
