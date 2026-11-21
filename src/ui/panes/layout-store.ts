import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { VaultPath } from '../../domain/vault/index.ts';
import { useApp } from '../services.ts';
import { currentTab, initialLayout, restoreLayout, type Layout, type TabView } from './layout.ts';
import type { LayoutStorage } from './layout-storage.ts';

/**
 * The panes and tabs, apart from the vault store: a keystroke never touches
 * it, and a tab switch touches nothing else. Saved on every change.
 */
export type LayoutStore = StoreApi<Layout> & {
  /** Applies one of the layout rules (`layout.ts`) to the current layout. */
  readonly apply: (rule: (layout: Layout) => Layout) => void;
};

export function createLayoutStore({
  storage,
  exists,
  fallback,
}: {
  storage: LayoutStorage;
  exists: (path: VaultPath) => boolean;
  /** What a first launch (no saved layout) shows in its one tab. */
  fallback: { view: TabView; preview: boolean };
}): LayoutStore {
  const store = createStore<Layout>(
    () => restoreLayout(storage.load(), exists) ?? initialLayout(fallback),
  );
  store.subscribe((layout) => storage.save(layout));
  const apply = (rule: (layout: Layout) => Layout) => {
    const before = store.getState();
    const after = rule(before);
    if (after !== before) store.setState(after, true);
  };
  return { ...store, apply };
}

export function useLayout<T>(select: (layout: Layout) => T): T {
  return useStore(useApp().layout, select);
}

/** The note the active tab shows, or null: what the sidebar highlights. */
export function activeNotePath(layout: Layout): VaultPath | null {
  const { view } = currentTab(layout);
  return view.kind === 'note' ? view.path : null;
}
