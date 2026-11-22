import {
  openVault,
  VaultSession,
  type MarkdownPort,
  type SearchEngine,
  type VaultFiles,
} from '../application/index.ts';
import { createMiniSearchEngine } from '../adapters/search/index.ts';
import { browserLayoutStorage, type LayoutStorage } from '../ui/panes/layout-storage.ts';
import type { AppServices, PendingEdits } from '../ui/services.ts';
import { feedSearch } from './search-feed.ts';

/** What the window shows first: the app on a vault, or the first-start question. */
export type Boot =
  | {
      readonly kind: 'app';
      readonly services: AppServices;
      /** Where this device keeps its panes and tabs between launches. */
      readonly layoutStorage: LayoutStorage;
      /** Starts what may wait until the app is on screen: sync, the global key. */
      readonly start: () => void;
    }
  | {
      readonly kind: 'welcome';
      /** Why the folder chosen before could not be opened, or null on a first start. */
      readonly problem: string | null;
      readonly choose: () => Promise<void>;
    };

/** Reads the whole vault into a new session, with search fed from it. No git. */
export async function openSession(
  files: VaultFiles,
): Promise<{ session: VaultSession; search: SearchEngine }> {
  const session = new VaultSession();
  const search = createMiniSearchEngine();
  feedSearch(session, search);
  await openVault({ files, session });
  return { session, search };
}

/**
 * The panes and tabs, in the WebView's own `localStorage` in both modes: it
 * persists in the Mac app, and the layout is a per-device convenience that a
 * lost write costs nothing of (the notes and settings live elsewhere).
 */
export function deviceLayoutStorage(): LayoutStorage {
  return browserLayoutStorage(() => window.localStorage);
}

/** The open editors' unsaved typing, written all at once before a sync commits. */
let markdown: Promise<MarkdownPort> | null = null;

/**
 * The markdown reader and writer, which load with the editor after the
 * first paint, not at start: fetched once, and the same port every time.
 */
export function loadMarkdown(): Promise<MarkdownPort> {
  markdown ??= import('../adapters/markdown/index.ts').then(({ remarkMarkdown }) => remarkMarkdown);
  return markdown;
}

export function createPendingEdits(): PendingEdits & { flushAll(): Promise<void> } {
  const flushes = new Set<() => Promise<void>>();
  return {
    add(flush) {
      flushes.add(flush);
      return () => void flushes.delete(flush);
    },
    async flushAll() {
      await Promise.all([...flushes].map((flush) => flush()));
    },
  };
}
