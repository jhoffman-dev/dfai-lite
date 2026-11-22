import type { VaultChange, VaultSession } from '../../application/index.ts';
import { parseRoute } from '../routing/route.ts';
import { currentEntry, navigate } from '../routing/use-route.ts';
import type { UiStore } from '../state/ui-store.ts';
import {
  closeMissingNotes,
  currentTab,
  openInActive,
  openView,
  paneIndexOf,
  retargetNote,
  showInTab,
  type Layout,
  type OpenIn,
  type TabView,
} from './layout.ts';
import type { LayoutStore } from './layout-store.ts';

/** What a tab keeps while hidden, so coming back to it is where it was left. */
export interface TabMemory {
  scrollTop: number;
  /** The editor's caret, or null before the tab's editor first closes. */
  cursor: number | null;
}

/**
 * The layout store tied to the address bar: the hash names the active tab,
 * back and forward move through the active tabs' navigations, and the tabs
 * follow notes that are renamed or deleted. It decides no rule itself: the
 * rules are `layout.ts`, this only applies them and keeps history in step.
 */
export interface Workspace {
  /** Opens `view` where `openIn` says, as a new history entry unless `replace`. */
  open(view: TabView, openIn?: OpenIn, options?: { replace?: boolean; source?: boolean }): void;
  /** Applies a rule that rearranges (switch, close, move): the hash follows, with no new entry. */
  arrange(rule: (layout: Layout) => Layout): void;
  /** The hash changed under the app (back, forward, a typed address): the tabs follow it. */
  followHash(): void;
  /** Tabs follow a renamed note, and close on a deleted one. */
  followVault(change: VaultChange): void;
  memoryOf(tabId: string): TabMemory;
}

export function createWorkspace({
  layout,
  ui,
  session,
  canSplit,
}: {
  layout: LayoutStore;
  ui: UiStore;
  session: VaultSession;
  /** False on a phone-width window, where only the active pane shows. */
  canSplit: () => boolean;
}): Workspace {
  const memory = new Map<string, TabMemory>();
  const exists = (path: string) => session.file(path) !== null;

  const syncHash = (replace: boolean) => {
    const tab = currentTab(layout.getState());
    navigate(tab.view, { replace, entry: { tab: tab.id } });
  };
  const arrange = (rule: (current: Layout) => Layout) => {
    layout.apply(rule);
    syncHash(true);
  };

  return {
    open(view, openIn = 'active', { replace = false, source = ui.getState().source } = {}) {
      layout.apply((current) => openView(current, { view, openIn, source, canSplit: canSplit() }));
      syncHash(replace);
    },
    arrange,
    followHash() {
      const route = parseRoute(window.location.hash);
      if (route.kind === 'new') return; // the start route makes the note, then opens it
      const entry = currentEntry();
      if (entry !== null && paneIndexOf(layout.getState(), entry.tab) >= 0) {
        arrange((current) => showInTab(current, entry.tab, route));
      } else if (route.kind === 'home') {
        syncHash(true);
      } else {
        arrange((current) => openInActive(current, route));
      }
    },
    followVault(change) {
      if (change.kind === 'renamed') {
        arrange((current) => retargetNote(current, change.from, change.to));
      } else if (change.kind === 'deleted' || change.kind === 'loaded') {
        arrange((current) => closeMissingNotes(current, exists));
      }
    },
    memoryOf(tabId) {
      let kept = memory.get(tabId);
      if (kept === undefined) {
        kept = { scrollTop: 0, cursor: null };
        memory.set(tabId, kept);
      }
      return kept;
    },
  };
}
