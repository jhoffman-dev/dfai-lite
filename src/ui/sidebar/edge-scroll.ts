/** How near the tree's top or bottom edge a drag starts to scroll it. */
export const EDGE_PX = 32;
/** The most a drag scrolls the tree in one frame, with the pointer at the very edge or past it. */
export const MAX_STEP_PX = 12;

/** A scroller's box on screen, as `getBoundingClientRect` gives it. */
interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * How far to scroll the tree this frame for a drag at (`x`, `y`): up
 * (negative) near the top, down near the bottom, faster the nearer the edge,
 * and 0 away from both, beside the tree, or for a tree with no height yet.
 */
export function edgeScrollStep({ x, y }: { x: number; y: number }, box: Box): number {
  if (box.bottom <= box.top || x < box.left || x > box.right) return 0;
  const step = (depth: number) => Math.ceil(MAX_STEP_PX * Math.min(1, depth / EDGE_PX));
  if (y < box.top + EDGE_PX) return -step(box.top + EDGE_PX - y);
  if (y > box.bottom - EDGE_PX) return step(y - (box.bottom - EDGE_PX));
  return 0;
}
