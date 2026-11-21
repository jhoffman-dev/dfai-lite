import { render } from '@testing-library/react';
import {
  DEFAULT_SETTINGS,
  FAVORITES_PATH,
  openVault,
  VaultSession,
  type Settings,
} from '../../application/index.ts';
import {
  FixedClock,
  MemoryNoteStore,
  MemorySettingsStore,
  SimpleSearchEngine,
} from '../../application/testing/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { App } from '../app.tsx';
import { memoryLayoutStorage, type LayoutStorage } from '../panes/layout-storage.ts';
import type { AppServices } from '../services.ts';

/** A small fictional vault for the component tests. */
export const TEST_VAULT: Readonly<Record<VaultPath, string>> = {
  'Projects/Larkspur Payroll.md': 'The payroll move. #project/active\n\nWith [[Mara Quill]].\n',
  'Projects/Garden shed.md': 'A shed. #project/someday\n\nNeeds a [[Materials list]].\n',
  'People/Mara Quill.md': 'Leads payroll operations. #person\n',
  'Welcome.md': 'Hello. #help\n',
  [FAVORITES_PATH]: '["Projects/Larkspur Payroll.md"]',
};

/**
 * Tanstack Virtual measures its scroller, and jsdom lays nothing out: give
 * every element a height so the tree draws its rows.
 */
export function giveElementsASize(): void {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 260 });
}

/**
 * Renders the whole app on `files`, in the rendered view unless told
 * otherwise. The tabs are kept in memory (`layout`), never in jsdom's storage.
 */
export async function renderApp({
  files = TEST_VAULT,
  preview = true,
  layout = memoryLayoutStorage(),
}: {
  files?: Readonly<Record<VaultPath, string>>;
  preview?: boolean;
  layout?: LayoutStorage;
} = {}) {
  const noteStore = MemoryNoteStore.of(files);
  const session = new VaultSession();
  const search = new SimpleSearchEngine();
  await openVault({ store: noteStore, session });
  search.index(
    session.index.paths().map((path) => ({ path, text: session.file(path)?.text ?? '' })),
  );
  const initial: Settings = { ...DEFAULT_SETTINGS, ui: { ...DEFAULT_SETTINGS.ui, preview } };
  const services: AppServices = {
    noteStore,
    session,
    search,
    settings: new MemorySettingsStore(initial),
    clock: new FixedClock(),
    sync: null,
    reconnect: () => undefined,
  };
  return { services, layout, ...render(<App services={services} layoutStorage={layout} />) };
}
