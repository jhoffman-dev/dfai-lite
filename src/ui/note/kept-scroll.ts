import { useLayoutEffect, useRef } from 'react';
import type { TabMemory } from '../panes/workspace.ts';

/** Puts the tab's scroll back where it was left, and keeps it when the tab is hidden. */
export function useKeptScroll(memory: TabMemory) {
  const article = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const page = article.current;
    const scroller = page?.closest<HTMLElement>('[role="tabpanel"]') ?? null;
    if (page === null || scroller === null) return;
    scroller.scrollTop = memory.scrollTop;
    const stopHolding = holdScrollWhileLoading({ page, scroller, top: memory.scrollTop });
    return () => {
      stopHolding();
      memory.scrollTop = scroller.scrollTop;
    };
  }, [memory]);
  return article;
}

/** What the person does to scroll on their own, which ends the hold. */
const OWN_SCROLL = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;

/**
 * Keeps the page at `top` while it grows as it loads — the editor after its
 * first paint, then each picture as it is read and drawn, which take no room
 * until then — so going back to a note lands where it was left, pictures and
 * all. Let go the moment the person scrolls, clicks or types.
 */
export function holdScrollWhileLoading({
  page,
  scroller,
  top,
}: {
  page: HTMLElement;
  scroller: HTMLElement;
  top: number;
}): () => void {
  if (top <= 0 || typeof ResizeObserver === 'undefined') return () => undefined;
  const observer = new ResizeObserver(() => {
    if (scroller.scrollTop !== top) scroller.scrollTop = top;
  });
  const stop = () => {
    observer.disconnect();
    for (const kind of OWN_SCROLL) scroller.removeEventListener(kind, stop, true);
  };
  // The page holds its window's height at least, and its content can run past
  // it: what grows is the content, so each part of it is watched.
  for (const part of [page, ...page.querySelectorAll<HTMLElement>(':scope > *, .page__body')]) {
    observer.observe(part);
  }
  for (const kind of OWN_SCROLL)
    scroller.addEventListener(kind, stop, { capture: true, passive: true });
  return stop;
}
