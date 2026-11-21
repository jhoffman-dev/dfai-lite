export type { Clock } from './clock.ts';
export type { GitCommand, GitPort, GitResult } from './git.ts';
export type { SearchEngine, SearchHit } from './search-engine.ts';
export {
  DEFAULT_CAPTURE_HOTKEY,
  DEFAULT_SETTINGS,
  DEFAULT_UI_PREFS,
  type Settings,
  type SettingsStore,
  type UiPrefs,
} from './settings-store.ts';
export {
  FileChangedError,
  FileExistsError,
  type StoredFile,
  type VaultFiles,
  type VaultSnapshot,
} from './vault-files.ts';
