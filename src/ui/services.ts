import { createContext, useContext } from 'react';
import type {
  Clock,
  MarkdownPort,
  SearchEngine,
  SettingsStore,
  VaultDeps,
  VaultFiles,
  VaultSession,
} from '../application/index.ts';
import type { OpenNotes } from './note/open-notes.ts';
import type { LayoutStore } from './panes/layout-store.ts';
import type { Workspace } from './panes/workspace.ts';
import type { DesktopControls } from './settings/desktop-controls.ts';
import type { NoteActions } from './state/note-actions.ts';
import type { SyncControls } from './sync/sync-status.ts';
import type { UiStore } from './state/ui-store.ts';
import type { VaultStore } from './state/vault-store.ts';

/**
 * Typing not saved yet, by every open editor: sync writes it before it
 * commits. An editor adds its flush while open and takes it away on close.
 */
/**
 * The markdown port, loaded after the first paint: the same promise each
 * call, a failed one included, until asked for `afresh`.
 */
export type LoadMarkdown = (options?: { afresh?: boolean }) => Promise<MarkdownPort>;

export interface PendingEdits {
  add(flush: () => Promise<void>): () => void;
}

/** What the composition root hands the UI: the open session and the ports it reads and writes. */
export interface AppServices {
  readonly files: VaultFiles;
  readonly session: VaultSession;
  readonly settings: SettingsStore;
  readonly clock: Clock;
  readonly search: SearchEngine;
  /** Null in a browser, on the sample vault: nothing syncs there. */
  readonly sync: SyncControls | null;
  /** The Mac app's own controls (vault folder, hotkey); null in a browser. */
  readonly desktop: DesktopControls | null;
  readonly pendingEdits: PendingEdits;
  /** The markdown reader and writer the editor saves through, loaded with it after the first paint. */
  readonly loadMarkdown: LoadMarkdown;
}

/** The services plus the stores the components read slices of. */
export interface AppContextValue {
  readonly services: AppServices;
  readonly deps: VaultDeps;
  readonly vault: VaultStore;
  readonly ui: UiStore;
  /** The panes and tabs: apart from the vault store, so neither re-renders the other. */
  readonly layout: LayoutStore;
  readonly workspace: Workspace;
  readonly openNotes: OpenNotes;
  readonly actions: NoteActions;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) throw new Error('A component that needs the app was rendered outside <App>.');
  return value;
}
