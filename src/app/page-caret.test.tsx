import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { vi } from 'vitest';
import type { MarkdownPort } from '../application/index.ts';
import type { VaultPath } from '../domain/vault/index.ts';
import { memoryLayoutStorage } from '../ui/panes/layout-storage.ts';
import { giveElementsASize, renderApp, TEST_VAULT } from '../ui/testing/render-app.tsx';
import { loadMarkdown } from './app-boot.ts';

/*
 * Click anywhere to type: a press on the page's empty space (beside the
 * text, under the title, below the last line) puts the caret in the text,
 * and a new note takes the caret by itself. Every name here is made up.
 */

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

beforeAll(() => {
  giveElementsASize();
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  document.elementFromPoint = () => null;
});
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

const PLAN: VaultPath = 'Projects/Plan.md';
const LINES = 'First line.\n\nSecond line.\n\nThird line.\n';
/** Where the text column is drawn in these tests: jsdom lays nothing out. */
const COLUMN = DOMRect.fromRect({ x: 100, y: 100, width: 600, height: 200 });

function editorOf(element: HTMLElement): Editor {
  const editor = (element as HTMLElement & { editor?: Editor }).editor;
  if (editor === undefined) throw new Error('No editor on the note’s text.');
  return editor;
}

async function openNote(text = LINES) {
  const app = await renderApp({
    files: { ...TEST_VAULT, [PLAN]: text },
    source: false,
    loadMarkdown,
  });
  await go(`#/note/${encodeURIComponent(PLAN)}`);
  const field = await screen.findByRole('textbox', { name: 'Note text' }, { timeout: 8000 });
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(COLUMN);
  return { ...app, field, editor: editorOf(field) };
}

/** A press on the page, outside the text, at (x, y); let go at once. */
function pressPage(element: Element, { x, y }: { x: number; y: number }) {
  const pressed = fireEvent.mouseDown(element, { button: 0, clientX: x, clientY: y });
  fireEvent.mouseUp(window);
  return pressed;
}

const pageOf = (field: HTMLElement) => field.closest('article')?.querySelector('.page__body');

describe('a press on the page outside the text', () => {
  it('below the last line puts the caret at the end of the note, focused', async () => {
    const { field, editor } = await openNote();
    pressPage(pageOf(field)!, { x: 400, y: 600 });
    expect(document.activeElement).toBe(field);
    expect(editor.state.selection.from).toBe(Selection.atEnd(editor.state.doc).from);
  });

  it('beside a line puts the caret on that line, read just inside the column', async () => {
    const { field, editor } = await openNote();
    const second = 'First line.'.length + 3;
    const posAtCoords = vi.fn(() => ({ pos: second, inside: -1 }));
    editor.view.posAtCoords = posAtCoords;
    pressPage(pageOf(field)!, { x: 20, y: 180 });
    expect(posAtCoords).toHaveBeenCalledWith({ left: 101, top: 180 });
    expect(editor.state.selection.from).toBe(second);
    expect(editor.state.selection.$from.parent.textContent).toBe('Second line.');
    expect(document.activeElement).toBe(field);
  });

  it('in the gap under the title puts the caret at the start of the text', async () => {
    const { field, editor } = await openNote();
    act(() => {
      editor.commands.setTextSelection(20);
    });
    pressPage(pageOf(field)!, { x: 300, y: 60 });
    expect(editor.state.selection.from).toBe(1);
  });

  it('dragged on into the text selects from where it was pressed', async () => {
    const { field, editor } = await openNote();
    editor.view.posAtCoords = vi.fn(() => ({ pos: 5, inside: -1 }));
    fireEvent.mouseDown(pageOf(field)!, { button: 0, clientX: 400, clientY: 600 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 300, clientY: 150 });
    fireEvent.mouseUp(window);
    const { anchor, head } = editor.state.selection;
    expect(anchor).toBe(Selection.atEnd(editor.state.doc).from);
    expect(head).toBe(5);
  });

  it('on the block handle is the handle’s: no caret is placed, and its click opens the menu', async () => {
    const { field, editor } = await openNote();
    const paragraph = field.querySelector('p')!;
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 100, width: 600, height: 24 }),
    );
    editor.view.posAtCoords = () => ({ pos: 1, inside: 0 });
    fireEvent.mouseMove(field, { clientX: 120, clientY: 110 });
    const handle = await waitFor(() => {
      const shown = document.querySelector<HTMLElement>('.block-handle:not([hidden])');
      expect(shown).not.toBeNull();
      return shown!;
    });
    const before = editor.state.selection.from;
    expect(pressPage(handle, { x: 80, y: 110 })).toBe(true);
    expect(editor.state.selection.from).toBe(before);
    fireEvent.click(handle);
    expect(await screen.findByRole('menu', { name: 'Block' })).toBeInTheDocument();
  });

  it('in a split, focuses that pane’s note and makes its pane the active one', async () => {
    const tab = (id: string, path: VaultPath) => ({
      tabs: [{ id, view: { kind: 'note' as const, path }, source: false }],
      activeTab: id,
    });
    await renderApp({
      files: { ...TEST_VAULT, [PLAN]: LINES },
      source: false,
      loadMarkdown,
      layout: memoryLayoutStorage({
        panes: [tab('t1', PLAN), tab('t2', 'Welcome.md')],
        activePane: 0,
        split: 0.5,
        nextId: 3,
      }),
    });
    const right = screen.getByRole('region', { name: 'Right pane' });
    const field = await within(right).findByRole(
      'textbox',
      { name: 'Note text' },
      { timeout: 8000 },
    );
    vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(COLUMN);
    const page = pageOf(field)!;
    fireEvent.pointerDown(page);
    pressPage(page, { x: 400, y: 600 });
    expect(document.activeElement).toBe(field);
    await waitFor(() => expect(right).toHaveClass('is-focused'));
  });

  it('in the markdown view puts the caret at the end of the field', async () => {
    const files = { ...TEST_VAULT, [PLAN]: LINES };
    await renderApp({ files, source: true, loadMarkdown });
    await go(`#/note/${encodeURIComponent(PLAN)}`);
    const field = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'Note markdown',
    });
    vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(COLUMN);
    pressPage(pageOf(field)!, { x: 400, y: 600 });
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(LINES.length);
  });
});

describe('a new note', () => {
  it('has the caret in its text, not its title, from the New note button', async () => {
    await renderApp({ source: false, loadMarkdown });
    await userEvent.click(screen.getAllByRole('button', { name: /New note/ })[0]!);
    const field = await screen.findByRole('textbox', { name: 'Note text' }, { timeout: 8000 });
    await waitFor(() => expect(document.activeElement).toBe(field));
    const hint = () => field.querySelector('[data-placeholder="Start writing…"]');
    expect(hint()).not.toBeNull();
    act(() => {
      editorOf(field).commands.insertContent('A');
    });
    expect(hint()).toBeNull();
  });

  it('keeps what is typed before the editor has loaded, and types it in when it lands', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held: Promise<MarkdownPort> = gate.then(() => loadMarkdown());
    const { services } = await renderApp({ source: false, loadMarkdown: () => held });
    await go('#/new');
    const waiting = await screen.findByText('', { selector: '.note-editor-placeholder' });
    await waitFor(() => expect(document.activeElement).toBe(waiting));
    for (const key of ['B', 'u', 'y', 'x', 'Backspace', ' ', 'm', 'i', 'l', 'k']) {
      fireEvent.keyDown(document.activeElement!, { key });
    }
    await act(async () => {
      release();
      await held;
    });
    const field = await screen.findByRole('textbox', { name: 'Note text' }, { timeout: 8000 });
    await waitFor(() => expect(field.textContent).toBe('Buy milk'));
    await waitFor(
      () => expect(services.session.file('Inbox/Untitled.md')?.text).toBe('Buy milk\n'),
      {
        timeout: 3000,
      },
    );
  });
});
