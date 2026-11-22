import { caretPlaceFor, type CaretTarget, type PagePoint } from './page-caret.ts';

/**
 * The markdown field (⌘E) as the page's caret target. `type` puts text in
 * the field as typing would, so it reaches the note as typing does.
 */
export function sourceCaretTarget(
  field: HTMLTextAreaElement,
  type: (next: string) => void,
): CaretTarget {
  return {
    placeAt(point, { extend }) {
      const head = offsetAt(field, point);
      const anchor = extend ? anchorOf(field) : head;
      field.focus({ preventScroll: true });
      const backward = head < anchor;
      field.setSelectionRange(
        Math.min(anchor, head),
        Math.max(anchor, head),
        backward ? 'backward' : 'forward',
      );
    },
    typeIn(text) {
      const { selectionStart, selectionEnd, value } = field;
      field.focus({ preventScroll: true });
      type(value.slice(0, selectionStart) + text + value.slice(selectionEnd));
      const after = selectionStart + text.length;
      // The field takes its new value on the next render; the caret follows it there.
      requestAnimationFrame(() => field.setSelectionRange(after, after));
    },
  };
}

function anchorOf(field: HTMLTextAreaElement): number {
  return field.selectionDirection === 'backward' ? field.selectionEnd : field.selectionStart;
}

/**
 * The offset a press beside the field stands for: the start or end of the
 * line at that height. Lines are counted as the file has them, so beside a
 * line that wraps the caret lands near it, not on it: a plain-text view
 * keeps no layout to ask, and near is enough for raw markdown.
 */
function offsetAt(field: HTMLTextAreaElement, point: PagePoint): number {
  const box = field.getBoundingClientRect();
  const place = caretPlaceFor(point, box);
  if (place.kind === 'start') return 0;
  if (place.kind === 'end') return field.value.length;
  const style = getComputedStyle(field);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6 || 20;
  const lines = field.value.split('\n');
  const row = Math.floor((place.y - box.top - (parseFloat(style.paddingTop) || 0)) / lineHeight);
  const index = Math.min(Math.max(row, 0), lines.length - 1);
  const lineStart = lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
  return point.x < box.left ? lineStart : lineStart + (lines[index]?.length ?? 0);
}
