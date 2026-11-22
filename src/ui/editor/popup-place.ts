/** A rectangle on the page, in client coordinates. */
export interface Area {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** Where a popup goes, and whether it had to open upward to be seen. */
export interface PopupPlacement {
  readonly top: number;
  readonly left: number;
  /** Above its anchor rather than below: there was no room under it. */
  readonly flipped: boolean;
  /** The height it is held to when neither side has room for all of it; null when one has. */
  readonly maxHeight: number | null;
}

/** The space between a popup and the caret it hangs from, in CSS pixels. */
export const POPUP_GAP = 6;

/**
 * Where a popup of `size` hangs from `anchor` (the caret's rectangle) so that
 * all of it is within `visible`. Under the anchor when it fits there, as a
 * popup always was; above it when only that side has room; and on the roomier
 * side, held to that room, when neither does. Sideways it is slid, never
 * flipped: a list reads from its left edge, so it keeps the caret's left
 * unless that would push it off the right edge.
 */
export function placePopup({
  anchor,
  size,
  visible,
  gap = POPUP_GAP,
}: {
  anchor: Area;
  size: { readonly width: number; readonly height: number };
  visible: Area;
  gap?: number;
}): PopupPlacement {
  const visibleBottom = visible.top + visible.height;
  // An anchor the keyboard has covered is judged from the visible edge it is
  // past, or the popup "above" it would open under the keyboard too.
  const anchorTop = clamp(anchor.top, visible.top, visibleBottom);
  const anchorBottom = clamp(anchor.top + anchor.height, visible.top, visibleBottom);
  const below = anchorBottom + gap;
  const roomBelow = visibleBottom - below;
  const roomAbove = anchorTop - gap - visible.top;
  const left = Math.max(
    visible.left,
    Math.min(anchor.left, visible.left + visible.width - size.width),
  );

  if (size.height <= roomBelow) return { top: below, left, flipped: false, maxHeight: null };
  if (size.height <= roomAbove) {
    return { top: anchorTop - gap - size.height, left, flipped: true, maxHeight: null };
  }
  if (roomAbove > roomBelow) {
    const maxHeight = Math.max(0, roomAbove);
    return { top: anchorTop - gap - maxHeight, left, flipped: true, maxHeight };
  }
  return { top: below, left, flipped: false, maxHeight: Math.max(0, roomBelow) };
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
