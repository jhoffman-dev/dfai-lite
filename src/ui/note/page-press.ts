import type { MouseEvent as ReactMouseEvent } from 'react';
import type { PageCaret } from './page-caret.ts';

/**
 * What answers a press itself: the text, the page's chrome, and any control.
 * A press anywhere else on the page is a press to type.
 */
const ANSWERS_ITS_OWN_PRESS = [
  '[contenteditable="true"]',
  '.page-bar',
  '.note-tags',
  '.mentions',
  '.raw-block',
  '.block-handle',
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  '[role="button"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
].join(', ');

/** The class of the note's text as it shows while the editor loads; it takes the focus and the keys meanwhile. */
export const LOADING_TEXT_CLASS = 'note-editor-placeholder';

/**
 * A press on the page's empty space (the margins, the gap under the title,
 * everything below the last line) puts the caret in the text there, as
 * Apple Notes does; dragging on from it selects, as dragging in text does.
 */
export function pressToType(caret: PageCaret) {
  return (event: ReactMouseEvent<HTMLElement>) => {
    const page = event.currentTarget;
    const target = event.target;
    if (event.button !== 0 || !(target instanceof Element)) return;
    // A portal's popup (a menu, the suggestions) bubbles here through React but is not on the page.
    if (!page.contains(target) || target.closest(ANSWERS_ITS_OWN_PRESS) !== null) return;
    // Kept from the browser: it would take the focus off the text and start a selection of the page.
    event.preventDefault();
    caret.placeAt({ x: event.clientX, y: event.clientY }, { extend: event.shiftKey });
    if (!caret.attached()) {
      page.querySelector<HTMLElement>(`.${LOADING_TEXT_CLASS}`)?.focus({ preventScroll: true });
    }
    followDrag(caret);
  };
}

function followDrag(caret: PageCaret): void {
  const stop = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', stop);
  };
  const move = (event: MouseEvent) => {
    if ((event.buttons & 1) === 0) stop();
    else caret.placeAt({ x: event.clientX, y: event.clientY }, { extend: true });
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', stop);
}
