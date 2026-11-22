import type { Layout } from './layout.ts';

/** Where this device keeps its window layout between launches. */
export interface LayoutStorage {
  /** The saved layout as parsed JSON, unchecked; null when there is none or it cannot be read. */
  load(): unknown;
  save(layout: Layout): void;
}

const LAYOUT_KEY = 'dfai-lite:layout';

/**
 * The layout in `localStorage`, beside the settings but under its own key:
 * it changes on every tab opened, the settings almost never. Storage that
 * is full or blocked (a private window, where even reaching it throws)
 * loses the layout, never the app.
 */
export function browserLayoutStorage(storage: () => Storage): LayoutStorage {
  return {
    load() {
      try {
        const raw = storage().getItem(LAYOUT_KEY);
        return raw === null ? null : (JSON.parse(raw) as unknown);
      } catch {
        // Unreadable or blocked: start with a fresh layout.
        return null;
      }
    },
    save(layout) {
      try {
        storage().setItem(LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        // Full or blocked storage: the layout is a convenience, so it is not kept this time.
      }
    },
  };
}

/** A layout kept in memory only: for tests, and where there is no storage. */
export function memoryLayoutStorage(initial: unknown = null): LayoutStorage & { saved: unknown } {
  const holder = {
    saved: initial,
    load: () => holder.saved,
    save: (layout: Layout) => {
      holder.saved = JSON.parse(JSON.stringify(layout)) as unknown;
    },
  };
  return holder;
}
