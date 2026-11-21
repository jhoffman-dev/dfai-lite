import {
  createNoteFromLink,
  createQuickNote,
  deleteNote,
  renameFolder,
  renameNote,
  reorderFavorite,
  tagKey,
  toggleFavoriteNote,
  type RenameResult,
  type SettingsStore,
  type UiPrefs,
  type VaultDeps,
} from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { currentTab, setPreview, type OpenIn } from '../panes/layout.ts';
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
  updatePrefs(patch: Partial<UiPrefs>): void;
  /** The active tab's rendered view or editor, remembered on this device for the next tab. */
  togglePreview(): void;
  /** Shows `error`'s message as a notice: for a promise nobody else awaits. */
  report(error: unknown): void;
}

export function createNoteActions({
  deps,
  ui,
  settings,
  layout,
  workspace,
}: {
  deps: VaultDeps;
  ui: UiStore;
  settings: SettingsStore;
  layout: LayoutStore;
  workspace: Workspace;
}): NoteActions {
  const notice = (message: string) => ui.setState({ notice: message });
  const report = (error: unknown) =>
    notice(error instanceof Error ? error.message : 'Something went wrong.');
  const updatePrefs = (patch: Partial<UiPrefs>) => {
    const current = settings.load();
    settings.save({ ...current, ui: { ...current.ui, ...patch } });
  };

  return {
    openNote: (path, openIn) => workspace.open({ kind: 'note', path }, openIn),
    async newNote({ folder, replace = false } = {}) {
      const path = await createQuickNote(deps, folder === undefined ? {} : { folder });
      ui.setState({ pendingFocus: { path, target: 'editor' } });
      workspace.open({ kind: 'note', path }, 'new-tab', { replace, preview: false });
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
    remove: (path) => deleteNote(deps, { path }),
    async renameFolder(from, to) {
      const result = await renameFolder(deps, { from, to });
      if (result.kind === 'refused') notice(result.reason);
    },
    startRename(path) {
      ui.setState({ pendingFocus: { path, target: 'title' } });
      workspace.open({ kind: 'note', path });
    },
    updatePrefs,
    togglePreview() {
      const tab = currentTab(layout.getState());
      if (tab.view.kind !== 'note') return;
      const preview = !tab.preview;
      layout.apply((current) => setPreview(current, tab.id, preview));
      ui.setState({ preview });
      updatePrefs({ preview });
    },
    report,
  };
}
