import { vi } from 'vitest';
import { caretPlaceFor, createPageCaret, heldKeyOf, type CaretTarget } from './page-caret.ts';

const COLUMN = { top: 100, bottom: 300, left: 100, right: 700 };

describe('where a press outside the text puts the caret', () => {
  it('above the text: at its start', () => {
    expect(caretPlaceFor({ x: 400, y: 99 }, COLUMN)).toEqual({ kind: 'start' });
  });

  it('below the last line, or on its bottom edge: at its end', () => {
    expect(caretPlaceFor({ x: 400, y: 300 }, COLUMN)).toEqual({ kind: 'end' });
    expect(caretPlaceFor({ x: 10, y: 900 }, COLUMN)).toEqual({ kind: 'end' });
  });

  it('beside a line: on that line, just inside the column on the side pressed', () => {
    expect(caretPlaceFor({ x: 20, y: 150 }, COLUMN)).toEqual({ kind: 'beside', x: 101, y: 150 });
    expect(caretPlaceFor({ x: 950, y: 150 }, COLUMN)).toEqual({ kind: 'beside', x: 699, y: 150 });
  });
});

function fakeTarget(): CaretTarget & { placed: unknown[]; typed: string[] } {
  const placed: unknown[] = [];
  const typed: string[] = [];
  return {
    placed,
    typed,
    placeAt: (point, options) => placed.push({ point, options }),
    typeIn: (text) => typed.push(text),
  };
}

describe('the page caret', () => {
  it('hands a press straight to the view once it is attached', () => {
    const caret = createPageCaret();
    const target = fakeTarget();
    caret.attach(target);
    caret.placeAt({ x: 1, y: 2 }, { extend: true });
    expect(target.placed).toEqual([{ point: { x: 1, y: 2 }, options: { extend: true } }]);
    expect(caret.attached()).toBe(true);
  });

  it('holds the last press and the keys typed while loading, and replays them on attach', () => {
    const caret = createPageCaret();
    caret.placeAt({ x: 1, y: 1 }, { extend: false });
    caret.placeAt({ x: 5, y: 5 }, { extend: false });
    caret.placeAt({ x: 9, y: 9 }, { extend: true });
    for (const text of ['a', 'b', '\n', 'c']) caret.hold({ kind: 'text', text });
    caret.hold({ kind: 'back' });
    const target = fakeTarget();
    caret.attach(target);
    expect(target.placed).toEqual([{ point: { x: 5, y: 5 }, options: { extend: false } }]);
    expect(target.typed).toEqual(['ab\n']);
  });

  it('replays nothing to a view attached with nothing held, nor twice', () => {
    const caret = createPageCaret();
    const first = fakeTarget();
    const detach = caret.attach(first);
    detach();
    expect(caret.attached()).toBe(false);
    const second = fakeTarget();
    caret.attach(second);
    expect([...first.placed, ...first.typed, ...second.placed, ...second.typed]).toEqual([]);
  });

  it('keeps the newer view when an older one detaches late', () => {
    const caret = createPageCaret();
    const detachOld = caret.attach(fakeTarget());
    const newer = { placeAt: vi.fn(), typeIn: vi.fn() };
    caret.attach(newer);
    detachOld();
    caret.placeAt({ x: 0, y: 0 }, { extend: false });
    expect(newer.placeAt).toHaveBeenCalledTimes(1);
  });
});

describe('the key a keystroke types while the editor loads', () => {
  const key = (name: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) =>
    heldKeyOf({ key: name, metaKey: false, ctrlKey: false, ...mods });

  it('is the character, a new line for Enter, a backspace for Backspace', () => {
    expect(key('a')).toEqual({ kind: 'text', text: 'a' });
    expect(key('é')).toEqual({ kind: 'text', text: 'é' });
    expect(key('Enter')).toEqual({ kind: 'text', text: '\n' });
    expect(key('Backspace')).toEqual({ kind: 'back' });
  });

  it('is nothing for a shortcut or a key that types nothing', () => {
    expect(key('n', { metaKey: true })).toBeNull();
    expect(key('a', { ctrlKey: true })).toBeNull();
    expect(key('Shift')).toBeNull();
    expect(key('ArrowLeft')).toBeNull();
  });
});
