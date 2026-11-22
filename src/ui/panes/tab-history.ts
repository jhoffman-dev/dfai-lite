import type { VaultPath } from '../../domain/vault/index.ts';
import type { TabView } from './layout.ts';

/**
 * A tab's Back and Forward, as a browser tab keeps them: DFAI's
 * `navigation-history.ts`, kept per tab. Pure: every rule returns a new
 * history, or the same one when nothing changed.
 */
export interface TabHistory {
  /** What the tab shows now. */
  readonly view: TabView;
  /** Oldest first; the last is where Back goes. */
  readonly back: readonly TabView[];
  /** Nearest first; the first is where Forward goes. */
  readonly forward: readonly TabView[];
}

export type HistoryStep = 'back' | 'forward';

/** How many places each way a tab remembers; the oldest are forgotten first. */
export const HISTORY_LIMIT = 50;

export function sameView(left: TabView, right: TabView): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'note' && right.kind === 'note') return left.path === right.path;
  if (left.kind === 'tags' && right.kind === 'tags') return left.tag === right.tag;
  return true;
}

/** A blank tab is nowhere to go back to: a new tab's history starts at its first open. */
function remembered(view: TabView): boolean {
  return view.kind !== 'home';
}

/**
 * The tab now shows `view`. Opening something new forgets whatever Forward
 * held, as a browser does; showing what it already shows is not a step.
 */
export function visit<T extends TabHistory>(tab: T, view: TabView): T {
  if (sameView(tab.view, view)) return tab;
  const back = remembered(tab.view) ? [...tab.back, tab.view].slice(-HISTORY_LIMIT) : tab.back;
  return { ...tab, view, back, forward: [] };
}

/** One step back or forward, or the same tab when there is nowhere to go. */
export function step<T extends TabHistory>(tab: T, direction: HistoryStep): T {
  const from = direction === 'back' ? tab.back : tab.forward;
  const target = direction === 'back' ? from.at(-1) : from[0];
  if (target === undefined) return tab;
  const rest = direction === 'back' ? from.slice(0, -1) : from.slice(1);
  const left = remembered(tab.view) ? [tab.view] : [];
  if (direction === 'back') {
    return { ...tab, view: target, back: rest, forward: [...left, ...tab.forward] };
  }
  return {
    ...tab,
    view: target,
    back: [...tab.back, ...left].slice(-HISTORY_LIMIT),
    forward: rest,
  };
}

/** Where `direction` would go, or null when that button is disabled. */
export function destination(tab: TabHistory, direction: HistoryStep): TabView | null {
  return (direction === 'back' ? tab.back.at(-1) : tab.forward[0]) ?? null;
}

/** A renamed or moved note: every place in the tab that showed it follows. */
export function followRename<T extends TabHistory>(tab: T, from: VaultPath, to: VaultPath): T {
  const moved = (view: TabView) => view.kind === 'note' && view.path === from;
  if (![tab.view, ...tab.back, ...tab.forward].some(moved)) return tab;
  const follow = (view: TabView): TabView => (moved(view) ? { kind: 'note', path: to } : view);
  return {
    ...tab,
    view: follow(tab.view),
    back: tab.back.map(follow),
    forward: tab.forward.map(follow),
  };
}

/**
 * Forgets every place on a note that is gone, so Back and Forward never lead
 * to a deleted note; two places left side by side that are the same become
 * one step. A tab whose own note is gone goes back to the last place before
 * it; with none, it has nothing left to show (null).
 */
export function forgetMissing<T extends TabHistory>(
  tab: T,
  exists: (path: VaultPath) => boolean,
): T | null {
  const kept = (view: TabView) => view.kind !== 'note' || exists(view.path);
  let back = withoutRepeats(tab.back.filter(kept));
  let forward = withoutRepeats(tab.forward.filter(kept));
  let view = tab.view;
  if (!kept(view)) {
    const previous = back.at(-1);
    if (previous === undefined) return null;
    view = previous;
    back = back.slice(0, -1);
  }
  if (isSame(back.at(-1), view)) back = back.slice(0, -1);
  if (isSame(forward[0], view)) forward = forward.slice(1);
  const unchanged =
    view === tab.view && back.length === tab.back.length && forward.length === tab.forward.length;
  return unchanged ? tab : { ...tab, view, back, forward };
}

function isSame(view: TabView | undefined, other: TabView): boolean {
  return view !== undefined && sameView(view, other);
}

function withoutRepeats(views: readonly TabView[]): TabView[] {
  return views.filter((view, at) => at === 0 || !sameView(views[at - 1] as TabView, view));
}
