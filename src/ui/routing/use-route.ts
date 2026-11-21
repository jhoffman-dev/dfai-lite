import { useMemo, useSyncExternalStore } from 'react';
import { formatRoute, parseRoute, type Route } from './route.ts';

/** Fired when the app moves the route itself: `pushState` and `replaceState` fire no `hashchange`. */
const REPLACED = 'lite:route-replaced';

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  window.addEventListener(REPLACED, listener);
  return () => {
    window.removeEventListener('hashchange', listener);
    window.removeEventListener(REPLACED, listener);
  };
}

const currentHash = (): string => window.location.hash;

/**
 * The route the hash names now, re-read on back, forward and every navigation.
 * The same object until the hash changes, so effects that depend on it run once per move.
 */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, currentHash);
  return useMemo(() => parseRoute(hash), [hash]);
}

/** What a history entry remembers beside its hash: the tab that showed it. */
export interface RouteEntry {
  readonly tab: string;
}

/** The tab the current history entry was made in, if the app made it. */
export function currentEntry(): RouteEntry | null {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null) return null;
  const tab = (state as Record<string, unknown>)['tab'];
  return typeof tab === 'string' ? { tab } : null;
}

/**
 * Goes to `route`, shown in tab `entry.tab`. `replace` swaps the history
 * entry instead of adding one: for redirects (`#/new` becoming the note it
 * made) and tab switches, which back should skip.
 */
export function navigate(
  route: Route,
  { replace = false, entry = null }: { replace?: boolean; entry?: RouteEntry | null } = {},
): void {
  const hash = formatRoute(route);
  if (window.location.hash === hash && currentEntry()?.tab === entry?.tab) return;
  // The query is dropped: `?new` asked once, and a reload must not ask again.
  const url = `${window.location.pathname}${hash}`;
  if (replace) window.history.replaceState(entry, '', url);
  else window.history.pushState(entry, '', url);
  window.dispatchEvent(new Event(REPLACED));
}
