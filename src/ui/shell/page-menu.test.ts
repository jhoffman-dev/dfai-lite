import { afterEach, describe, expect, it } from 'vitest';
import { keepPageMenuToText } from './page-menu.ts';

keepPageMenuToText(document);

function rightClick(target: Element): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function place(html: string): Element {
  document.body.innerHTML = html;
  const target = document.querySelector('[data-target]');
  if (target === null) throw new Error('no target');
  return target;
}

describe('the page menu', () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('is turned off on the chrome', () => {
    expect(rightClick(place('<nav><button data-target>Inbox</button></nav>'))).toBe(true);
  });

  it('stays in the editor, a field and the read view', () => {
    expect(rightClick(place('<div contenteditable="true"><p data-target>hi</p></div>'))).toBe(
      false,
    );
    expect(rightClick(place('<input data-target />'))).toBe(false);
    expect(rightClick(place('<article class="read-view"><p data-target>hi</p></article>'))).toBe(
      false,
    );
  });

  it('stays while text is selected, for Copy', () => {
    const target = place('<p data-target>some words</p>');
    document.getSelection()?.selectAllChildren(target);
    expect(rightClick(target)).toBe(false);
  });
});
