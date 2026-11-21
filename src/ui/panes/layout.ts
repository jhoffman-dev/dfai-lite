import type { VaultPath } from '../../domain/vault/index.ts';
import type { Route } from '../routing/route.ts';

/**
 * How the main area is arranged: one or two panes side by side, each with a
 * row of tabs. These are window-layout rules, not vault rules: nothing here
 * reads or writes a note. Every function returns a new layout and never
 * mutates the one it was given.
 */

/** What a tab shows: a route the hash can name. `home` is a blank tab. */
export type TabView = Exclude<Route, { kind: 'new' }>;

/** Where an opened note or view goes: the active tab, a new tab, or the other pane. */
export type OpenIn = 'active' | 'new-tab' | 'side';

export interface Tab {
  readonly id: string;
  readonly view: TabView;
  /** Rendered view (true) or the editor (false), per tab. */
  readonly preview: boolean;
}

export interface Pane {
  readonly tabs: readonly Tab[];
  readonly activeTab: string;
}

export interface Layout {
  /** One pane, or two side by side: never more. */
  readonly panes: readonly Pane[];
  readonly activePane: number;
  /** The first pane's share of the width, when split. */
  readonly split: number;
  /** The number the next tab's id is made from. */
  readonly nextId: number;
}

export const BLANK: TabView = { kind: 'home' };
export const MAX_PANES = 2;
export const EVEN_SPLIT = 0.5;
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;

export function initialLayout({ view = BLANK, preview = false } = {}): Layout {
  return {
    panes: [{ tabs: [{ id: 't1', view, preview }], activeTab: 't1' }],
    activePane: 0,
    split: EVEN_SPLIT,
    nextId: 2,
  };
}

export function sameView(left: TabView, right: TabView): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'note' && right.kind === 'note') return left.path === right.path;
  if (left.kind === 'tags' && right.kind === 'tags') return left.tag === right.tag;
  return true;
}

export function activePaneOf(layout: Layout): Pane {
  const pane = layout.panes[layout.activePane];
  if (pane === undefined) throw new Error('A layout always has an active pane.');
  return pane;
}

export function activeTabOf(pane: Pane): Tab {
  const tab = pane.tabs.find((candidate) => candidate.id === pane.activeTab);
  if (tab === undefined) throw new Error('A pane always has an active tab.');
  return tab;
}

/** The tab the window is showing now. */
export function currentTab(layout: Layout): Tab {
  return activeTabOf(activePaneOf(layout));
}

/** Which pane holds `tabId`, or -1. */
export function paneIndexOf(layout: Layout, tabId: string): number {
  return layout.panes.findIndex((pane) => pane.tabs.some((tab) => tab.id === tabId));
}

function withPane(layout: Layout, index: number, pane: Pane): Layout {
  return { ...layout, panes: layout.panes.map((old, at) => (at === index ? pane : old)) };
}

function mintTab(layout: Layout, view: TabView, preview: boolean): [Layout, Tab] {
  const tab = { id: `t${layout.nextId}`, view, preview };
  return [{ ...layout, nextId: layout.nextId + 1 }, tab];
}

/** Puts `tab` just after the pane's active tab and makes it active. */
function insertAfterActive(pane: Pane, tab: Tab): Pane {
  const at = pane.tabs.findIndex((candidate) => candidate.id === pane.activeTab) + 1;
  return { tabs: [...pane.tabs.slice(0, at), tab, ...pane.tabs.slice(at)], activeTab: tab.id };
}

/**
 * Shows `view` in the active tab, replacing what it showed, unless a tab of
 * the active pane already shows it: then that tab is focused instead.
 */
export function openInActive(layout: Layout, view: TabView): Layout {
  const pane = activePaneOf(layout);
  const existing = pane.tabs.find((tab) => sameView(tab.view, view));
  if (existing !== undefined)
    return withPane(layout, layout.activePane, { ...pane, activeTab: existing.id });
  const tabs = pane.tabs.map((tab) => (tab.id === pane.activeTab ? { ...tab, view } : tab));
  return withPane(layout, layout.activePane, { ...pane, tabs });
}

/** Shows `view` in a new tab after the active one; a blank active tab is reused. */
export function openInNewTab(layout: Layout, view: TabView, preview: boolean): Layout {
  const pane = activePaneOf(layout);
  if (activeTabOf(pane).view.kind === 'home') return openInActive(layout, view);
  const [minted, tab] = mintTab(layout, view, preview);
  return withPane(minted, layout.activePane, insertAfterActive(pane, tab));
}

/**
 * Shows `view` in the other pane, splitting the window if it is not yet:
 * focuses a tab there that already shows it, else opens it in a new tab.
 */
export function openToSide(layout: Layout, view: TabView, preview: boolean): Layout {
  if (layout.panes.length < MAX_PANES) {
    const [minted, tab] = mintTab(layout, view, preview);
    return {
      ...minted,
      panes: [...layout.panes, { tabs: [tab], activeTab: tab.id }],
      activePane: 1,
    };
  }
  return openInNewTab({ ...layout, activePane: otherPane(layout) }, view, preview);
}

/**
 * Where an open goes. Splitting is off on a phone-width window, where only
 * the active pane shows: there "to the side" becomes a new tab.
 */
export function openView(
  layout: Layout,
  {
    view,
    openIn,
    preview,
    canSplit,
  }: { view: TabView; openIn: OpenIn; preview: boolean; canSplit: boolean },
): Layout {
  if (openIn === 'side' && canSplit) {
    const there = layout.panes[otherPane(layout)]?.tabs.find((tab) => sameView(tab.view, view));
    return there === undefined ? openToSide(layout, view, preview) : activate(layout, there.id);
  }
  if (openIn === 'active') return openInActive(layout, view);
  return openInNewTab(layout, view, preview);
}

function otherPane(layout: Layout): number {
  return layout.activePane === 0 ? 1 : 0;
}

export function activate(layout: Layout, tabId: string): Layout {
  const index = paneIndexOf(layout, tabId);
  const pane = layout.panes[index];
  if (pane === undefined) return layout;
  return { ...withPane(layout, index, { ...pane, activeTab: tabId }), activePane: index };
}

export function focusPane(layout: Layout, index: number): Layout {
  return layout.panes[index] === undefined ? layout : { ...layout, activePane: index };
}

export function focusOtherPane(layout: Layout): Layout {
  return focusPane(layout, otherPane(layout));
}

/** Drops pane `index` (it has no tabs left); the last pane is never dropped. */
function dropPane(layout: Layout, index: number): Layout {
  return { ...layout, panes: layout.panes.filter((_, at) => at !== index), activePane: 0 };
}

/** Removes `tabId` from its pane, without fixing up an emptied pane. */
function withoutTab(layout: Layout, tabId: string): { layout: Layout; pane: number } {
  const index = paneIndexOf(layout, tabId);
  const pane = layout.panes[index];
  if (pane === undefined) return { layout, pane: -1 };
  const at = pane.tabs.findIndex((tab) => tab.id === tabId);
  const tabs = pane.tabs.filter((tab) => tab.id !== tabId);
  // The neighbour to the right takes focus, as in a browser; else the one to the left.
  const next = tabs[Math.min(at, tabs.length - 1)];
  const activeTab = pane.activeTab === tabId ? (next?.id ?? '') : pane.activeTab;
  return { layout: withPane(layout, index, { tabs, activeTab }), pane: index };
}

/** A pane left with no tabs closes; the last pane instead shows a blank tab. */
function settleEmptied(layout: Layout, index: number, preview: boolean): Layout {
  const pane = layout.panes[index];
  if (pane === undefined || pane.tabs.length > 0) return layout;
  if (layout.panes.length > 1) return dropPane(layout, index);
  const [minted, tab] = mintTab(layout, BLANK, preview);
  return withPane(minted, index, { tabs: [tab], activeTab: tab.id });
}

/** Closes a tab. Closing a pane's last tab closes the pane, unless it is the last pane. */
export function closeTab(layout: Layout, tabId: string, { preview = false } = {}): Layout {
  const removed = withoutTab(layout, tabId);
  return removed.pane < 0 ? layout : settleEmptied(removed.layout, removed.pane, preview);
}

export function closeOthers(layout: Layout, tabId: string): Layout {
  const index = paneIndexOf(layout, tabId);
  const pane = layout.panes[index];
  const tab = pane?.tabs.find((candidate) => candidate.id === tabId);
  if (tab === undefined) return layout;
  return { ...withPane(layout, index, { tabs: [tab], activeTab: tabId }), activePane: index };
}

/**
 * Moves a tab to `index` in pane `toPane` (its own pane, to reorder). The
 * pane the move empties closes. `toPane` one past the last pane splits the
 * window, unless the tab is the only one its pane has.
 */
export function moveTab(
  layout: Layout,
  { tabId, toPane, index }: { tabId: string; toPane: number; index: number },
): Layout {
  const from = paneIndexOf(layout, tabId);
  const source = layout.panes[from];
  const tab = source?.tabs.find((candidate) => candidate.id === tabId);
  const opensPane = toPane === layout.panes.length;
  if (source === undefined || tab === undefined || toPane < 0 || toPane > layout.panes.length) {
    return layout;
  }
  if (opensPane && (toPane >= MAX_PANES || source.tabs.length === 1)) return layout;
  const removed = withoutTab(layout, tabId).layout;
  const target = removed.panes[toPane]?.tabs ?? [];
  const at = Math.max(0, Math.min(index, target.length));
  const placed: Pane = {
    tabs: [...target.slice(0, at), tab, ...target.slice(at)],
    activeTab: tabId,
  };
  const panes = opensPane ? [...removed.panes, placed] : removed.panes;
  const moved = { ...withPane({ ...removed, panes }, toPane, placed), activePane: toPane };
  if ((moved.panes[from]?.tabs.length ?? 0) > 0) return moved;
  return { ...dropPane(moved, from), activePane: toPane > from ? toPane - 1 : toPane };
}

/** Moves a tab to the other pane, splitting the window when there is one pane. */
export function moveToOtherPane(layout: Layout, tabId: string): Layout {
  const from = paneIndexOf(layout, tabId);
  if (from < 0) return layout;
  const to = layout.panes.length === 1 ? 1 : from === 0 ? 1 : 0;
  return moveTab(layout, { tabId, toPane: to, index: layout.panes[to]?.tabs.length ?? 0 });
}

/** A second pane to the right, showing what `tabId` shows (the active tab if not given). */
export function splitRight(layout: Layout, tabId?: string): Layout {
  if (layout.panes.length >= MAX_PANES) return layout;
  const source =
    tabId === undefined
      ? currentTab(layout)
      : layout.panes.flatMap((pane) => pane.tabs).find((tab) => tab.id === tabId);
  if (source === undefined) return layout;
  const [minted, tab] = mintTab(layout, source.view, source.preview);
  return { ...minted, panes: [...layout.panes, { tabs: [tab], activeTab: tab.id }], activePane: 1 };
}

/** ⌘\: split right; or, when split and the other pane shows nothing, unsplit. */
export function toggleSplit(layout: Layout): Layout {
  if (layout.panes.length < MAX_PANES) return splitRight(layout);
  const other = layout.panes[otherPane(layout)];
  if (other?.tabs.every((tab) => tab.view.kind === 'home') !== true) return layout;
  return dropPane(layout, otherPane(layout));
}

/** The next (`step` 1) or previous (-1) tab of the active pane, wrapping around. */
export function cycleTab(layout: Layout, step: 1 | -1): Layout {
  const pane = activePaneOf(layout);
  const at = pane.tabs.findIndex((tab) => tab.id === pane.activeTab);
  const next = pane.tabs[(at + step + pane.tabs.length) % pane.tabs.length];
  return next === undefined ? layout : activate(layout, next.id);
}

/** ⌘1–8 go to that tab; ⌘9 to the last, as in a browser. */
export function jumpToTab(layout: Layout, position: number): Layout {
  const { tabs } = activePaneOf(layout);
  const tab = position >= 9 ? tabs[tabs.length - 1] : tabs[position - 1];
  return tab === undefined ? layout : activate(layout, tab.id);
}

export function setPreview(layout: Layout, tabId: string, preview: boolean): Layout {
  const index = paneIndexOf(layout, tabId);
  const pane = layout.panes[index];
  if (pane === undefined) return layout;
  const tabs = pane.tabs.map((tab) => (tab.id === tabId ? { ...tab, preview } : tab));
  return withPane(layout, index, { ...pane, tabs });
}

/** Points tab `tabId` at `view`, as the history entry being returned to says. */
export function showInTab(layout: Layout, tabId: string, view: TabView): Layout {
  const index = paneIndexOf(layout, tabId);
  const pane = layout.panes[index];
  if (pane === undefined) return layout;
  const tabs = pane.tabs.map((tab) => (tab.id === tabId ? { ...tab, view } : tab));
  return activate(withPane(layout, index, { ...pane, tabs }), tabId);
}

export function setSplit(layout: Layout, split: number): Layout {
  return { ...layout, split: clampSplit(split) };
}

export function clampSplit(split: number): number {
  return Number.isFinite(split) ? Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, split)) : EVEN_SPLIT;
}

/** A renamed or moved note: every tab that showed it follows. */
export function retargetNote(layout: Layout, from: VaultPath, to: VaultPath): Layout {
  const follows = (tab: Tab) => tab.view.kind === 'note' && tab.view.path === from;
  if (!layout.panes.some((pane) => pane.tabs.some(follows))) return layout;
  const panes = layout.panes.map((pane) => ({
    ...pane,
    tabs: pane.tabs.map((tab): Tab =>
      follows(tab) ? { ...tab, view: { kind: 'note', path: to } } : tab,
    ),
  }));
  return { ...layout, panes };
}

/** Closes every tab whose note no longer exists (deleted, or gone after a reload). */
export function closeMissingNotes(layout: Layout, exists: (path: VaultPath) => boolean): Layout {
  const missing = layout.panes.flatMap((pane) =>
    pane.tabs.filter((tab) => tab.view.kind === 'note' && !exists(tab.view.path)),
  );
  return missing.reduce((next, tab) => closeTab(next, tab.id, { preview: tab.preview }), layout);
}

/**
 * A layout saved on this device, checked field by field. Anything malformed
 * gives null (the caller starts fresh); tabs on notes that no longer exist
 * are dropped, and so is a pane they leave empty.
 */
export function restoreLayout(raw: unknown, exists: (path: VaultPath) => boolean): Layout | null {
  if (!isRecord(raw) || !Array.isArray(raw['panes'])) return null;
  const panes = raw['panes'].map(paneFrom);
  if (panes.length === 0 || panes.length > MAX_PANES || panes.some((pane) => pane === null)) {
    return null;
  }
  const ids = panes.flatMap((pane) => pane?.tabs.map((tab) => tab.id) ?? []);
  if (new Set(ids).size !== ids.length) return null;
  const numbers = ids.map((id) => Number(id.slice(1)));
  const activePane = raw['activePane'] === 1 && panes.length === 2 ? 1 : 0;
  const split = typeof raw['split'] === 'number' ? clampSplit(raw['split']) : EVEN_SPLIT;
  const layout: Layout = {
    panes: panes.filter((pane): pane is Pane => pane !== null),
    activePane,
    split,
    nextId: Math.max(0, ...numbers) + 1,
  };
  return closeMissingNotes(layout, exists);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function paneFrom(raw: unknown): Pane | null {
  if (!isRecord(raw) || !Array.isArray(raw['tabs'])) return null;
  const tabs = raw['tabs'].map(tabFrom);
  if (tabs.length === 0 || tabs.some((tab) => tab === null)) return null;
  const valid = tabs.filter((tab): tab is Tab => tab !== null);
  const active = valid.find((tab) => tab.id === raw['activeTab']) ?? valid[0];
  return active === undefined ? null : { tabs: valid, activeTab: active.id };
}

function tabFrom(raw: unknown): Tab | null {
  if (!isRecord(raw) || typeof raw['id'] !== 'string' || !/^t\d+$/.test(raw['id'])) return null;
  const view = viewFrom(raw['view']);
  if (view === null) return null;
  return { id: raw['id'], view, preview: raw['preview'] === true };
}

function viewFrom(raw: unknown): TabView | null {
  if (!isRecord(raw)) return null;
  switch (raw['kind']) {
    case 'home':
    case 'graph':
      return { kind: raw['kind'] };
    case 'note':
      return typeof raw['path'] === 'string' && raw['path'] !== ''
        ? { kind: 'note', path: raw['path'] }
        : null;
    case 'tags':
      return raw['tag'] === null || typeof raw['tag'] === 'string'
        ? { kind: 'tags', tag: raw['tag'] }
        : null;
    default:
      return null;
  }
}
