import { useSyncExternalStore } from 'react';

/** The width below which the sidebar is a drawer and only the active pane shows. */
const NARROW = '(max-width: 720px)';

function query(): MediaQueryList | null {
  // jsdom has no matchMedia: there the window counts as wide.
  return typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null;
}

export function isNarrow(): boolean {
  return query()?.matches ?? false;
}

function subscribe(listener: () => void): () => void {
  const list = query();
  list?.addEventListener('change', listener);
  return () => list?.removeEventListener('change', listener);
}

/** Whether the window is phone-width now, re-read when it crosses the line. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, isNarrow);
}
