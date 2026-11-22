import type { VaultPath } from '../../domain/vault/index.ts';

/** How this Mac shows the app. Device-local: never synced. New fields are added, never renamed. */
export interface UiPrefs {
  readonly theme: 'system' | 'light' | 'dark';
  readonly expandedFolders: readonly VaultPath[];
  /** The note open when the app was last closed, reopened on start. */
  readonly lastOpenPath: VaultPath | null;
  /** The note's markdown as plain text (true), or the editor (false), when a note opens. */
  readonly source: boolean;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  theme: 'system',
  expandedFolders: [],
  lastOpenPath: null,
  source: false,
};

/** The key that makes a new note from anywhere on the Mac, as Tauri names keys. */
export const DEFAULT_CAPTURE_HOTKEY = 'Alt+Command+N';

export interface Settings {
  /** The vault folder on this Mac; null until one is chosen. Unused in the browser. */
  readonly vaultPath: string | null;
  /** The global quick-capture key, e.g. `Alt+Command+N`; empty for none. */
  readonly captureHotkey: string;
  readonly ui: UiPrefs;
}

export const DEFAULT_SETTINGS: Settings = {
  vaultPath: null,
  captureHotkey: DEFAULT_CAPTURE_HOTKEY,
  ui: DEFAULT_UI_PREFS,
};

/**
 * This device's settings (a file in the app's config folder on the Mac,
 * localStorage in the browser). Synchronous, because the app reads them
 * before its first paint. `load` never throws: missing or unreadable
 * settings load as {@link DEFAULT_SETTINGS}, field by field.
 */
export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): void;
}
