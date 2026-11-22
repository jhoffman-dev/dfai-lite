import { DEFAULT_SETTINGS, DEFAULT_UI_PREFS, type Settings } from '../../application/index.ts';
import { SETTINGS_KEY, createFileSettingsStore, createLocalSettingsStore } from './index.ts';

/** `Storage` over a Map: the part of localStorage the store uses. */
class MapStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const SAVED: Settings = {
  vaultPath: '/Users/mara/Notes',
  captureHotkey: 'Control+Alt+N',
  ui: {
    theme: 'dark',
    expandedFolders: ['Projects'],
    lastOpenPath: 'Projects/Plan.md',
    source: true,
    sidebarWidth: 312,
    sidebarCollapsed: true,
  },
};

describe('the local settings store', () => {
  it('loads the defaults when nothing is saved', () => {
    expect(createLocalSettingsStore(new MapStorage()).load()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips what it saves', () => {
    const storage = new MapStorage();
    createLocalSettingsStore(storage).save(SAVED);
    expect(createLocalSettingsStore(storage).load()).toEqual(SAVED);
  });

  it('loads the defaults for settings that are not JSON, without throwing', () => {
    const storage = new MapStorage();
    storage.setItem(SETTINGS_KEY, '{"vaultPath":"/Users/mara/Notes", oops');
    expect(createLocalSettingsStore(storage).load()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the fields it can read and defaults the rest, one by one', () => {
    const storage = new MapStorage();
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        vaultPath: 7,
        captureHotkey: 'Control+Alt+N',
        ui: {
          theme: 'neon',
          expandedFolders: ['A', 3],
          lastOpenPath: 'A.md',
          source: 'yes',
          sidebarWidth: 'wide',
          sidebarCollapsed: 1,
        },
      }),
    );
    expect(createLocalSettingsStore(storage).load()).toEqual({
      vaultPath: null,
      captureHotkey: 'Control+Alt+N',
      ui: { ...DEFAULT_UI_PREFS, lastOpenPath: 'A.md' },
    });
  });
});

describe('settings this build does not know', () => {
  it('are kept through a load and a save, so a newer build’s fields round-trip', async () => {
    const text = JSON.stringify({
      ...SAVED,
      syncPaused: true,
      ui: { ...SAVED.ui, paneWidths: [1, 2] },
    });
    const written: string[] = [];
    const store = createFileSettingsStore({
      text,
      write: async (json) => void written.push(json),
      onError: () => undefined,
    });
    const loaded = store.load();
    store.save({ ...loaded, ui: { ...loaded.ui, sidebarWidth: 280 } });
    await store.written();
    const saved = JSON.parse(written[0] ?? '{}') as Record<string, unknown>;
    expect(saved).toMatchObject({
      syncPaused: true,
      ui: { paneWidths: [1, 2], sidebarWidth: 280, theme: 'dark' },
    });
  });
});

describe('the file settings store', () => {
  it('answers from memory and writes each save whole, in order', async () => {
    const written: string[] = [];
    const store = createFileSettingsStore({
      text: null,
      write: async (text) => void written.push(text),
      onError: (error) => {
        throw error;
      },
    });
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    store.save(SAVED);
    store.save({ ...SAVED, vaultPath: '/Users/mara/Other' });
    expect(store.load().vaultPath).toBe('/Users/mara/Other');
    await vi.waitFor(() => expect(written).toHaveLength(2));
    const reopened = createFileSettingsStore({
      text: written[1] ?? null,
      write: async () => undefined,
      onError: () => undefined,
    });
    expect(reopened.load()).toEqual({ ...SAVED, vaultPath: '/Users/mara/Other' });
  });

  it('reports a failed write and keeps the settings in memory', async () => {
    const errors: unknown[] = [];
    const store = createFileSettingsStore({
      text: JSON.stringify(SAVED),
      write: () => Promise.reject(new Error('disk full')),
      onError: (error) => errors.push(error),
    });
    store.save({ ...SAVED, captureHotkey: '' });
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(store.load().captureHotkey).toBe('');
  });
});
