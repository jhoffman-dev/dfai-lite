/** Where the pointer pressed on the page, in the window's coordinates. */
export interface PagePoint {
  readonly x: number;
  readonly y: number;
}

/** The box the note's text is laid out in: the editor, or the markdown field. */
export interface TextColumn {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * Where a press outside the text puts the caret, as Apple Notes and
 * Obsidian do: above the text (the gap under the title) at its start,
 * below the last line at its end, and beside a line at that line, as if
 * the press had landed just inside the column.
 */
export type CaretPlace =
  | { readonly kind: 'start' }
  | { readonly kind: 'end' }
  | { readonly kind: 'beside'; readonly x: number; readonly y: number };

/** A pixel inside the column's edge, so a point beside a line reads as on it. */
const INSET = 1;

export function caretPlaceFor(point: PagePoint, column: TextColumn): CaretPlace {
  if (point.y < column.top) return { kind: 'start' };
  if (point.y >= column.bottom) return { kind: 'end' };
  const x = Math.min(Math.max(point.x, column.left + INSET), column.right - INSET);
  return { kind: 'beside', x, y: point.y };
}

/** What a view on the note (the editor, the markdown field) does with a press on the page. */
export interface CaretTarget {
  /** Focuses the text and puts the caret at `point`; `extend` keeps the selection's anchor. */
  placeAt(point: PagePoint, options: { readonly extend: boolean }): void;
  /** Types what was keyed while the view was still loading, at the caret. */
  typeIn(text: string): void;
}

/**
 * The page's line to whichever view shows the note. The editor loads
 * lazily, so a press, or keys typed, before it has mounted are held and
 * handed to it when it attaches: nothing done during the load is lost.
 */
export interface PageCaret {
  placeAt(point: PagePoint, options: { readonly extend: boolean }): void;
  /** Keeps keys typed while no view is attached; a view types them in when it attaches. */
  hold(key: HeldKey): void;
  attached(): boolean;
  attach(target: CaretTarget): () => void;
}

/** A key typed during the load: a character, a new line, or a backspace. */
export type HeldKey = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'back' };

export function createPageCaret(): PageCaret {
  let target: CaretTarget | null = null;
  let press: PagePoint | null = null;
  let typed = '';
  return {
    placeAt(point, options) {
      if (target !== null) target.placeAt(point, options);
      // A drag before the view is there has nothing to extend: the press it started from is kept.
      else if (!options.extend) press = point;
    },
    hold(key) {
      typed = key.kind === 'text' ? typed + key.text : typed.slice(0, -1);
    },
    attached: () => target !== null,
    attach(next) {
      target = next;
      if (press !== null) next.placeAt(press, { extend: false });
      if (typed !== '') next.typeIn(typed);
      press = null;
      typed = '';
      return () => {
        if (target === next) target = null;
      };
    },
  };
}

/** The key a keydown types while the editor loads, or null for one that types nothing. */
export function heldKeyOf(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}): HeldKey | null {
  // ⌥ is left alone: on a Mac it types characters (é, ø, —).
  if (event.metaKey || event.ctrlKey) return null;
  if (event.key === 'Enter') return { kind: 'text', text: '\n' };
  if (event.key === 'Backspace') return { kind: 'back' };
  return [...event.key].length === 1 ? { kind: 'text', text: event.key } : null;
}
