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
 * The route the hash names now, re-read on every move.
 * The same object until the hash changes, so effects that depend on it run once per move.
 */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, currentHash);
  return useMemo(() => parseRoute(hash), [hash]);
}

/**
 * Points the address at `route`, always in place: Back and Forward are each
 * tab's own (`panes/tab-history.ts`), so the webview's history is never
 * added to and has nothing to go back through.
 */
export function navigate(route: Route): void {
  const hash = formatRoute(route);
  if (window.location.hash === hash) return;
  // The query is dropped: `?new` asked once, and a reload must not ask again.
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
  window.dispatchEvent(new Event(REPLACED));
}
