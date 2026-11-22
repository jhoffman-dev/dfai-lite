import {
  DEFAULT_SETTINGS,
  DEFAULT_UI_PREFS,
  type Settings,
  type SettingsStore,
  type UiPrefs,
} from '../../application/index.ts';

/** Where the settings live in the browser's storage. */
export const SETTINGS_KEY = 'dfai-lite.settings';

/**
 * Settings in `localStorage`, as one JSON value: the app's in a browser,
 * where it runs on the sample vault.
 */
export function createLocalSettingsStore(storage: Storage): SettingsStore {
  return {
    load: () => parseSettings(storage.getItem(SETTINGS_KEY)),
    save: (settings) => storage.setItem(SETTINGS_KEY, JSON.stringify(settings)),
  };
}

/**
 * Settings in a file the host keeps (the app's config folder on the Mac).
 * The file is read once, before the first paint; `load` answers from
 * memory, and each `save` writes the whole file in the background. A
 * failed write goes to `onError`: the settings stay as saved in memory.
 */
export function createFileSettingsStore({
  text,
  write,
  onError,
}: {
  /** The file's text at start; null when there is none yet. */
  text: string | null;
  write: (text: string) => Promise<void>;
  onError: (error: unknown) => void;
}): SettingsStore & { written(): Promise<void> } {
  let current = parseSettings(text);
  let writing = Promise.resolve();
  return {
    load: () => current,
    save(settings) {
      current = settings;
      const json = `${JSON.stringify(settings, null, 2)}\n`;
      // In order, so an older write never lands after a newer one.
      writing = writing.then(() => write(json)).catch(onError);
    },
    /** Resolves once every save so far has been written (or its failure reported). */
    written: () => writing,
  };
}

/**
 * Settings from their JSON. Whatever cannot be read (missing, not JSON, a
 * field of the wrong shape) is its default, field by field, so one bad
 * field never costs the others. A field this build does not know (one a
 * newer build wrote) is kept as it was, so the next save writes it back.
 */
export function parseSettings(text: string | null): Settings {
  const raw = readJson(text);
  if (!isRecord(raw)) return DEFAULT_SETTINGS;
  return {
    ...raw,
    vaultPath: isString(raw.vaultPath) && raw.vaultPath !== '' ? raw.vaultPath : null,
    captureHotkey: isString(raw.captureHotkey) ? raw.captureHotkey : DEFAULT_SETTINGS.captureHotkey,
    ui: uiFrom(raw.ui),
  };
}

function readJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Unreadable settings load as the defaults, as the port promises.
    return null;
  }
}

type Fields = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';

const THEMES: readonly UiPrefs['theme'][] = ['system', 'light', 'dark'];

const isWidth = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

function uiFrom(raw: unknown): UiPrefs {
  if (!isRecord(raw)) return DEFAULT_UI_PREFS;
  const { theme, expandedFolders, lastOpenPath, source, sidebarWidth, sidebarCollapsed } = raw;
  return {
    ...raw,
    theme: THEMES.find((known) => known === theme) ?? DEFAULT_UI_PREFS.theme,
    expandedFolders:
      Array.isArray(expandedFolders) && expandedFolders.every(isString)
        ? expandedFolders
        : DEFAULT_UI_PREFS.expandedFolders,
    lastOpenPath: isString(lastOpenPath) ? lastOpenPath : DEFAULT_UI_PREFS.lastOpenPath,
    source: typeof source === 'boolean' ? source : DEFAULT_UI_PREFS.source,
    sidebarWidth: isWidth(sidebarWidth) ? sidebarWidth : DEFAULT_UI_PREFS.sidebarWidth,
    sidebarCollapsed:
      typeof sidebarCollapsed === 'boolean' ? sidebarCollapsed : DEFAULT_UI_PREFS.sidebarCollapsed,
  };
}
