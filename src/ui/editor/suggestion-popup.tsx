import { useEffect, useLayoutEffect, useRef } from 'react';
import { placePopup, POPUP_GAP } from './popup-place.ts';
import { onVisibleAreaChange, visibleArea } from './visible-area.ts';

export interface PopupItem {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
}

/**
 * The list that appears under the caret for `[[` links, `#` tags and `/`
 * commands.
 *
 * Deliberately not a popover: focus must stay in the editor or the caret is
 * lost, the popup is anchored to a caret rectangle rather than to a
 * trigger, and what is open and what is selected are already owned by
 * TipTap's suggestion plugin, which sees the keystrokes before ProseMirror
 * does. All a popover would add is anchored positioning, at the cost of a
 * second owner for the open state.
 *
 * The classes stay `suggest-option` / `atlas-suggestion`: TipTap's decoration
 * defaults to the class `suggestion`, and the collision once moved the caret to
 * column zero.
 */
export function SuggestionPopup({
  label,
  items,
  selected,
  rect,
  onPick,
  variant,
}: {
  label: string;
  items: readonly PopupItem[];
  selected: number;
  rect: DOMRect | null;
  onPick: (id: string) => void;
  variant?: 'notes';
}) {
  const list = useRef<HTMLUListElement>(null);
  // The list scrolls past 320px and the arrow keys wrap, so the row Enter
  // would pick is brought into view each time it moves; jsdom has no
  // scrollIntoView, hence the guard.
  useEffect(() => {
    const row = list.current?.querySelector('[aria-selected="true"]');
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function')
      row.scrollIntoView({ block: 'nearest' });
  }, [selected, items]);

  // Placed against the visible area, flipped above the caret when there is no
  // room under it. Measured and moved before the paint, and again whenever the
  // visible area changes. Where it fits is `placePopup`'s; this reads and
  // writes the DOM.
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) return;
    const place = () => {
      // Its own height, not the one the last placement held it to.
      element.style.maxHeight = '';
      const placed = placePopup({
        anchor: { top: rect?.top ?? 0, left: rect?.left ?? 0, width: 0, height: rect?.height ?? 0 },
        size: { width: element.offsetWidth, height: element.offsetHeight },
        visible: visibleArea(),
      });
      element.style.top = `${placed.top}px`;
      element.style.left = `${placed.left}px`;
      element.style.maxHeight = placed.maxHeight === null ? '' : `${placed.maxHeight}px`;
      element.dataset.flipped = placed.flipped ? 'true' : 'false';
    };
    place();
    return onVisibleAreaChange(place);
  }, [rect, items]);

  if (items.length === 0) return null;

  return (
    <ul
      ref={list}
      className={variant === undefined ? 'suggestions' : `suggestions suggestions--${variant}`}
      role="listbox"
      aria-label={label}
      style={{ top: (rect?.bottom ?? 0) + POPUP_GAP, left: rect?.left ?? 0 }}
    >
      {items.map((item, index) => (
        <li key={item.id}>
          <button
            type="button"
            role="option"
            aria-selected={index === selected}
            className={index === selected ? 'suggest-option suggest-option--on' : 'suggest-option'}
            onMouseDown={(event) => {
              // mousedown, not click: the editor would lose the caret first.
              event.preventDefault();
              onPick(item.id);
            }}
          >
            <span className="suggest-option__name">{item.label}</span>
            <span className="suggest-option__path">{item.hint}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
