import {
  createFolder,
  createNoteFromLink,
  createQuickNote,
  deleteFolder,
  deleteNote,
  moveFolderInto,
  moveNoteInto,
  renameFolder,
  renameNote,
  reorderFavorite,
  tagKey,
  toggleFavoriteNote,
  TrashRefusedError,
  type CreateFolderResult,
  type RenameResult,
  type SettingsStore,
  type UiPrefs,
  type VaultDeps,
} from '../../application/index.ts';
import type { FolderNode, VaultEntry, VaultPath } from '../../domain/vault/index.ts';
import { currentTab, setSource, type OpenIn } from '../panes/layout.ts';
import type { LayoutStore } from '../panes/layout-store.ts';
import type { Workspace } from '../panes/workspace.ts';
import type { UiStore } from './ui-store.ts';

/**
 * What a click or a key asks of the vault, in one place: each calls the
 * use-case, then moves the window to show the result. No rule lives here;
 * the use-cases decide, this only routes their answers. `openIn` says where
 * a note opens: the active tab (the default), a new tab, or the other pane.
 */
export interface NoteActions {
  openNote(path: VaultPath, openIn?: OpenIn): void;
  /**
   * A new `Untitled` note (in the Inbox unless a folder is given), open in a
   * new tab with the caret in it. `replace` swaps the history entry (for `#/new`).
   */
  newNote(options?: { folder?: VaultPath; replace?: boolean }): Promise<void>;
  /** Opens the note a link names, making it first if no note answers. */
  followLink(target: string, openIn?: OpenIn): Promise<void>;
  openTag(name: string, openIn?: OpenIn): void;
  toggleFavorite(path: VaultPath): Promise<void>;
  moveFavorite(path: VaultPath, index: number): Promise<void>;
  /** Renames or moves a note; the tabs showing it follow by themselves. */
  rename(from: VaultPath, to: VaultPath): Promise<RenameResult>;
  /** Deletes a note; the tabs showing it close by themselves. */
  remove(path: VaultPath): Promise<void>;
  /** Renames or moves a folder with every note in it; the open notes follow. */
  renameFolder(from: VaultPath, to: VaultPath): Promise<void>;
  /** Opens a note with its title ready to rename. */
  startRename(path: VaultPath): void;
  /** A new empty folder at `path`; a refusal is shown as a notice and returned. */
  createFolder(path: VaultPath): Promise<CreateFolderResult>;
  /**
   * Moves a note or a folder into `folder` ('' for the top), links and
   * favorites following; whatever is typed is saved first. A refusal (a
   * name already there) is shown as a notice; true when it moved.
   */
  moveInto(entry: VaultEntry, folder: VaultPath): Promise<boolean>;
  /** Deletes a folder, sending its notes to the Trash one by one, once the person says yes. */
  deleteFolder(path: VaultPath): Promise<void>;
  /** A yes-or-no question: the Mac's own alert in the app, the page's in a browser. */
  ask(question: { message: string; yes: string }): Promise<boolean>;
  /** Puts the sidebar away or back, or sets its width, remembered on this device. */
  setSidebar(change: { collapsed?: boolean; width?: number | null }): void;
  updatePrefs(patch: Partial<UiPrefs>): void;
  /** The active tab's rendered view or editor, remembered on this device for the next tab. */
  toggleSource(): void;
  /** Shows `error`'s message as a notice: for a promise nobody else awaits. */
  report(error: unknown): void;
}

export function createNoteActions({
  deps,
  ui,
  settings,
  layout,
  workspace,
  flushEdits = () => Promise.resolve(),
  confirm,
}: {
  deps: VaultDeps;
  ui: UiStore;
  settings: SettingsStore;
  layout: LayoutStore;
  workspace: Workspace;
  /** Saves what every open editor holds: run before a move. */
  flushEdits?: () => Promise<void>;
  /** A yes-or-no question for the person (the Mac's alert); absent where nothing can refuse. */
  confirm?: (question: { message: string; yes: string }) => Promise<boolean>;
}): NoteActions {
  const notice = (message: string) => ui.setState({ notice: message });
  const report = (error: unknown) =>
    notice(error instanceof Error ? error.message : 'Something went wrong.');
  const updatePrefs = (patch: Partial<UiPrefs>) => {
    const current = settings.load();
    settings.save({ ...current, ui: { ...current.ui, ...patch } });
  };
  const ask =
    confirm ??
    ((question: { message: string }) => Promise.resolve(window.confirm(question.message)));
  const moveInto = async (entry: VaultEntry, folder: VaultPath) => {
    await flushEdits();
    const result =
      entry.kind === 'note'
        ? await moveNoteInto(deps, { path: entry.path, folder })
        : await moveFolderInto(deps, { path: entry.path, folder });
    if (result.kind === 'refused') notice(result.reason);
    return result.kind !== 'refused';
  };
  const removeFolder = async (path: VaultPath): Promise<void> => {
    const first = await deleteFolder(deps, { path });
    if (first.kind === 'refused') return notice(first.reason);
    let { deleted, kept } = first;
    let declined = false;
    if (first.trashRefused) {
      const message = `The Trash would not take the notes in “${path}”. Delete the rest for good? Their history in git keeps them once synced.`;
      if (await ask({ message, yes: 'Delete permanently' })) {
        const rest = await deleteFolder(deps, { path, permanently: true, skip: kept });
        if (rest.kind === 'refused') return notice(rest.reason);
        deleted += rest.deleted;
        kept = [...kept, ...rest.kept];
      } else declined = true;
    }
    const summary = folderDeleteSummary({ deleted, total: first.total, kept, declined });
    if (summary !== null) notice(summary);
  };

  return {
    openNote: (path, openIn) => workspace.open({ kind: 'note', path }, openIn),
    async newNote({ folder, replace = false } = {}) {
      const path = await createQuickNote(deps, folder === undefined ? {} : { folder });
      ui.setState({ pendingFocus: { path, target: 'editor' } });
      workspace.open({ kind: 'note', path }, 'new-tab', { replace, source: false });
    },
    async followLink(target, openIn) {
      const result = await createNoteFromLink(deps, { target });
      if (result.kind === 'refused') notice(result.reason);
      else workspace.open({ kind: 'note', path: result.path }, openIn);
    },
    openTag: (name, openIn) => workspace.open({ kind: 'tags', tag: tagKey(name) }, openIn),
    toggleFavorite: (path) => toggleFavoriteNote(deps, { path }),
    moveFavorite: (path, index) => reorderFavorite(deps, { path, index }),
    async rename(from, to) {
      const result = await renameNote(deps, { from, to });
      if (result.kind === 'refused') notice(result.reason);
      return result;
    },
    async remove(path) {
      try {
        await deleteNote(deps, { path });
      } catch (error) {
        if (!(error instanceof TrashRefusedError) || confirm === undefined) throw error;
        const message = `The Trash would not take “${path}”. Delete it for good? Its history in git keeps it once synced.`;
        if (!(await confirm({ message, yes: 'Delete permanently' }))) return;
        await deleteNote(deps, { path, permanently: true });
      }
    },
    async renameFolder(from, to) {
      const result = await renameFolder(deps, { from, to });
      if (result.kind === 'refused') notice(result.reason);
    },
    async createFolder(path) {
      const result = await createFolder(deps, { path });
      if (result.kind === 'refused') notice(result.reason);
      return result;
    },
    moveInto,
    async deleteFolder(path) {
      const notes = deps.session.folderTree();
      const count = countNotesIn(notes, path);
      const message =
        count === 0
          ? `Delete the empty folder “${path}”?`
          : `Delete “${path}” and the ${count === 1 ? 'note' : `${count} notes`} in it? They go to the Trash.`;
      if (!(await ask({ message, yes: 'Delete' }))) return;
      await flushEdits();
      await removeFolder(path);
    },
    ask,
    setSidebar({ collapsed, width }) {
      if (collapsed !== undefined) {
        ui.setState({ sidebarCollapsed: collapsed });
        updatePrefs({ sidebarCollapsed: collapsed });
      }
      if (width !== undefined) {
        ui.setState({ sidebarWidth: width });
        updatePrefs({ sidebarWidth: width });
      }
    },
    startRename(path) {
      ui.setState({ pendingFocus: { path, target: 'title' } });
      workspace.open({ kind: 'note', path });
    },
    updatePrefs,
    toggleSource() {
      const tab = currentTab(layout.getState());
      if (tab.view.kind !== 'note') return;
      const source = !tab.source;
      layout.apply((current) => setSource(current, tab.id, source));
      ui.setState({ source });
      updatePrefs({ source });
    },
    report,
  };
}

/** How many notes the tree shows in a folder, at any depth. */
function countNotesIn(root: FolderNode, path: VaultPath): number {
  const walk = (folder: FolderNode): number | null => {
    if (folder.path === path) return folder.noteCount;
    for (const child of folder.folders) {
      const found = walk(child);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(root) ?? 0;
}

/** What a folder delete that did not delete everything says; null when it did. */
function folderDeleteSummary({
  deleted,
  total,
  kept,
  declined,
}: {
  deleted: number;
  total: number;
  kept: readonly VaultPath[];
  declined: boolean;
}): string | null {
  if (deleted === total) return null;
  const parts = [`Deleted ${deleted} of ${total} notes.`];
  if (kept.length > 0) {
    const names = kept.map((path) => path.slice(path.lastIndexOf('/') + 1, -3)).join(', ');
    parts.push(`Kept, as they changed on disk since you saw them: ${names}.`);
  }
  if (declined) parts.push('The Trash would not take the rest, so they were kept.');
  return parts.join(' ');
}
