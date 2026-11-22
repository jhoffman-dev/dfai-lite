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
  MemorySettingsStore,
  MemoryVaultFiles,
  plainMarkdown,
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

// One promise, as the app's loader gives: a new one each render would suspend the note each render.
const loadedPlainMarkdown = Promise.resolve(plainMarkdown);
const PLAIN_MARKDOWN: AppServices['loadMarkdown'] = () => loadedPlainMarkdown;

/**
 * Renders the whole app on `files`, notes shown as their plain markdown
 * unless told otherwise: the editor and its markdown reader load lazily,
 * and these tests are about the app around the note. The tabs are kept in
 * memory (`layout`), never in jsdom's storage.
 */
export async function renderApp({
  files = TEST_VAULT,
  source = true,
  layout = memoryLayoutStorage(),
  loadMarkdown = PLAIN_MARKDOWN,
}: {
  files?: Readonly<Record<VaultPath, string>>;
  source?: boolean;
  layout?: LayoutStorage;
  /** The markdown port: the UI's tests cannot reach the real one, so the note is read as one raw block. */
  loadMarkdown?: AppServices['loadMarkdown'];
} = {}) {
  const vaultFiles = MemoryVaultFiles.of(files);
  const session = new VaultSession();
  const search = new SimpleSearchEngine();
  await openVault({ files: vaultFiles, session });
  search.index(
    session.index.paths().map((path) => ({ path, text: session.file(path)?.text ?? '' })),
  );
  const initial: Settings = { ...DEFAULT_SETTINGS, ui: { ...DEFAULT_SETTINGS.ui, source } };
  const services: AppServices = {
    files: vaultFiles,
    session,
    search,
    settings: new MemorySettingsStore(initial),
    clock: new FixedClock(),
    sync: null,
    desktop: null,
    pendingEdits: { add: () => () => undefined },
    loadMarkdown,
  };
  return { services, layout, ...render(<App services={services} layoutStorage={layout} />) };
}
