import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { VaultEntry, VaultPath } from '../../domain/vault/index.ts';
import { useApp } from '../services.ts';

/** Where focus goes when a note next opens: straight into the text, or its title to rename it. */
export interface PendingFocus {
  readonly path: VaultPath;
  readonly target: 'editor' | 'title';
}

/** How the window is arranged right now. Nothing here is a vault fact. */
export interface UiState {
  readonly paletteOpen: boolean;
  readonly settingsOpen: boolean;
  /** The list of keyboard shortcuts. */
  readonly shortcutsOpen: boolean;
  /** The sidebar, on a phone-width screen where it is a drawer. */
  readonly drawerOpen: boolean;
  /** Rendered view (true) or the editor (false). */
  readonly source: boolean;
  readonly pendingFocus: PendingFocus | null;
  /** A short message for the person: a refused rename, a failed save. */
  readonly notice: string | null;
  /** The note or folder the folder picker is choosing a new home for; null when it is shut. */
  readonly moving: VaultEntry | null;
  /** The folder a new folder is being named in, in the tree ('' for the top); null when none is. */
  readonly namingFolderIn: VaultPath | null;
  /** The sidebar put away, on a wide window. */
  readonly sidebarCollapsed: boolean;
  /** The sidebar's width as dragged, in CSS pixels; null for the default. */
  readonly sidebarWidth: number | null;
}

export type UiStore = StoreApi<UiState>;

export function createUiStore({
  source,
  sidebarCollapsed = false,
  sidebarWidth = null,
}: {
  source: boolean;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number | null;
}): UiStore {
  return createStore<UiState>(() => ({
    paletteOpen: false,
    settingsOpen: false,
    shortcutsOpen: false,
    drawerOpen: false,
    source,
    pendingFocus: null,
    notice: null,
    moving: null,
    namingFolderIn: null,
    sidebarCollapsed,
    sidebarWidth,
  }));
}

export function useUi<T>(select: (state: UiState) => T): T {
  return useStore(useApp().ui, select);
}
