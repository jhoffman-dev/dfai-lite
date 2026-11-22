import type { VaultChange, VaultSession } from '../../application/index.ts';
import { formatRoute, parseRoute } from '../routing/route.ts';
import { navigate } from '../routing/use-route.ts';
import type { UiStore } from '../state/ui-store.ts';
import {
  closeMissingNotes,
  currentTab,
  openView,
  retargetNote,
  stepTab,
  tabById,
  type Layout,
  type OpenIn,
  type TabView,
} from './layout.ts';
import type { LayoutStore } from './layout-store.ts';
import { sameView, type HistoryStep } from './tab-history.ts';

/** What a tab keeps of a place while it shows another, so Back returns to where it was left. */
export interface TabMemory {
  scrollTop: number;
  /** The editor's caret, or null before the note's editor in this tab first closes. */
  cursor: number | null;
}

/**
 * The layout store tied to the app's moves. Back and Forward are each tab's
 * own (`tab-history.ts`), kept in the layout and saved with it; the address
 * only mirrors the active tab, always replaced, so the webview's own history
 * never grows and can never take a tab somewhere behind the app's back. It
 * decides no rule itself: the rules are `layout.ts`, this only applies them.
 */
export interface Workspace {
  /** Opens `view` where `openIn` says: in the active tab, a step Back can undo. */
  open(view: TabView, openIn?: OpenIn, options?: { source?: boolean }): void;
  /** Applies a rule that rearranges (switch, close, move); the address follows. */
  arrange(rule: (layout: Layout) => Layout): void;
  /** Back or Forward in tab `tabId`, the active tab if not given. */
  step(direction: HistoryStep, tabId?: string): void;
  /** The address changed under the app (a typed address, a deep link): the active tab opens it. */
  followHash(): void;
  /** Tabs follow a renamed note, and forget a deleted one. */
  followVault(change: VaultChange): void;
  /** What tab `tabId` keeps of `view`. */
  memoryOf(tabId: string, view: TabView): TabMemory;
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
  const keyOf = (tabId: string, view: TabView) => `${tabId} ${formatRoute(view)}`;
  const exists = (path: string) => session.file(path) !== null;

  const mirror = () => navigate(currentTab(layout.getState()).view);
  const arrange = (rule: (current: Layout) => Layout) => {
    layout.apply(rule);
    mirror();
  };
  /**
   * A fresh open starts at the top, as a link followed in a browser does: only
   * Back and Forward return to where a place was left. Forgotten before the
   * new layout lands, so the page never reads the old memory.
   */
  const forgetVisited = (before: Layout, after: Layout) => {
    const tab = currentTab(after);
    const was = tabById(before, tab.id);
    if (was !== undefined && !sameView(was.view, tab.view)) memory.delete(keyOf(tab.id, tab.view));
  };
  const open: Workspace['open'] = (view, openIn = 'active', { source } = {}) => {
    const shown = source ?? ui.getState().source;
    arrange((current) => {
      const next = openView(current, { view, openIn, source: shown, canSplit: canSplit() });
      forgetVisited(current, next);
      return next;
    });
  };

  return {
    open,
    arrange,
    step(direction, tabId) {
      arrange((current) => stepTab(current, tabId ?? currentTab(current).id, direction));
    },
    followHash() {
      const route = parseRoute(window.location.hash);
      if (route.kind === 'new') return; // the start route makes the note, then opens it
      if (route.kind === 'home' || sameView(route, currentTab(layout.getState()).view)) {
        mirror();
      } else {
        open(route);
      }
    },
    followVault(change) {
      if (change.kind === 'renamed') {
        arrange((current) => retargetNote(current, change.from, change.to));
      } else if (change.kind === 'deleted' || change.kind === 'loaded') {
        arrange((current) => closeMissingNotes(current, exists));
      }
    },
    memoryOf(tabId, view) {
      const key = keyOf(tabId, view);
      let kept = memory.get(key);
      if (kept === undefined) {
        kept = { scrollTop: 0, cursor: null };
        memory.set(key, kept);
      }
      return kept;
    },
  };
}
