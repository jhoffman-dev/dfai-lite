import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { vi } from 'vitest';
import { applyExternalChanges } from '../application/index.ts';
import type { MemoryVaultFiles } from '../application/testing/index.ts';
import type { VaultPath } from '../domain/vault/index.ts';
import { memoryLayoutStorage } from '../ui/panes/layout-storage.ts';
import { giveElementsASize, renderApp } from '../ui/testing/render-app.tsx';
import { loadMarkdown } from './app-boot.ts';

/*
 * A block's handle in the app, on the real markdown reader and writer: a
 * drag in one pane shows in the other and is saved once, as the moved
 * block's own bytes; undo and redo take it back and forth; a change on disk
 * mid-drag loses nothing; and the block menu's rows write what they say.
 * Every name here is made up.
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
const TABLE = '| Cycle | Date |\n|:--|--:|\n| First | 2026-11-28 |';
const ORIGINAL = `Intro.\n\n* fern\n* moss\n\n${TABLE}\n\nLast.\n`;

function editorOf(element: HTMLElement): Editor {
  const editor = (element as HTMLElement & { editor?: Editor }).editor;
  if (editor === undefined) throw new Error('No editor on the note’s text.');
  return editor;
}

async function savedAs(
  services: { session: { file(path: VaultPath): { text: string } | null } },
  text: string,
) {
  await waitFor(() => expect(services.session.file(PLAN)?.text).toBe(text), { timeout: 3000 });
}

/** Where top-level block `index` starts. */
function startOf(editor: Editor, index: number): number {
  let pos = 0;
  for (let at = 0; at < index; at += 1) pos += editor.state.doc.child(at).nodeSize;
  return pos;
}

/** Takes top-level block `from` by its handle, as the handle's drag does; `drop` lets it go. */
function dragBlock(editor: Editor, from: number) {
  const { view } = editor;
  const selection = NodeSelection.create(editor.state.doc, startOf(editor, from));
  act(() => {
    view.dispatch(editor.state.tr.setSelection(selection));
  });
  (view as unknown as { dragging: unknown }).dragging = {
    slice: selection.content(),
    move: true,
    node: selection,
  };
  return {
    dropBefore(index: number) {
      const at = startOf(editor, index);
      view.posAtCoords = () => ({ pos: at, inside: -1 });
      const drop = new Event('drop', { bubbles: true, cancelable: true });
      Object.assign(drop, {
        clientX: 0,
        clientY: 0,
        dataTransfer: { getData: () => '', types: [], files: [] },
      });
      act(() => {
        view.dom.dispatchEvent(drop);
      });
    },
  };
}

describe('a block dragged in a note open in two panes', () => {
  const tab = (id: string) => ({
    tabs: [{ id, view: { kind: 'note' as const, path: PLAN }, source: false }],
    activeTab: id,
  });

  async function openTwice() {
    const app = await renderApp({
      files: { [PLAN]: ORIGINAL },
      source: false,
      loadMarkdown,
      layout: memoryLayoutStorage({
        panes: [tab('t1'), tab('t2')],
        activePane: 0,
        split: 0.5,
        nextId: 3,
      }),
    });
    await waitFor(() =>
      expect(screen.getAllByRole('textbox', { name: 'Note text' })).toHaveLength(2),
    );
    const [left, right] = screen.getAllByRole('textbox', { name: 'Note text' }).map(editorOf);
    return { ...app, left: left!, right: right! };
  }

  it('shows the move in the other pane and saves it once, each block in its own bytes', async () => {
    const { left, right, services } = await openTwice();
    const writes = vi.spyOn(services.files, 'write');
    dragBlock(left, 2).dropBefore(0);
    expect(right.state.doc.child(0).type.name).toBe('table');
    await savedAs(services, `${TABLE}\n\nIntro.\n\n* fern\n* moss\n\nLast.\n`);
    // Past the save's own wait: nothing more is written for the one drag.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(writes.mock.calls.filter(([request]) => request.path === PLAN)).toHaveLength(1);
  });

  it('is taken back by undo and put again by redo, in both panes', async () => {
    const { left, right, services } = await openTwice();
    dragBlock(left, 2).dropBefore(0);
    const moved = `${TABLE}\n\nIntro.\n\n* fern\n* moss\n\nLast.\n`;
    await savedAs(services, moved);
    act(() => {
      left.commands.undo();
    });
    expect(right.state.doc.child(0).type.name).toBe('paragraph');
    await savedAs(services, ORIGINAL);
    act(() => {
      left.commands.redo();
    });
    expect(right.state.doc.child(0).type.name).toBe('table');
    await savedAs(services, moved);
  });

  it('loses nothing when the note changes on disk mid-drag', async () => {
    const { left, right, services } = await openTwice();
    const drag = dragBlock(left, 2);
    const onDisk = `Intro, edited by Claude.\n\n* fern\n* moss\n\n${TABLE}\n\nLast.\n`;
    (services.files as MemoryVaultFiles).edit(PLAN, onDisk);
    await act(() => applyExternalChanges(services, [PLAN]));
    drag.dropBefore(0);
    // Either the table moved, followed to where it now is, or the drop was refused:
    // never a block lost, doubled or taken in the table's place.
    const blocks = left.getJSON().content?.map((block) => block.type) ?? [];
    expect([...blocks].sort()).toEqual(['bulletList', 'paragraph', 'paragraph', 'table']);
    expect(left.getText()).toContain('Intro, edited by Claude.');
    expect(right.getJSON()).toEqual(left.getJSON());
  });
});

describe('the block menu', () => {
  async function openNote(original: string) {
    const app = await renderApp({ files: { [PLAN]: original }, source: false, loadMarkdown });
    await go(`#/note/${encodeURIComponent(PLAN)}`);
    const text = await screen.findByRole('textbox', { name: 'Note text' }, { timeout: 8000 });
    return { ...app, editor: editorOf(text) };
  }

  /** Opens the menu of the block the caret is in, as ⌘/ does. */
  async function menuAt(editor: Editor, pos: number) {
    act(() => {
      editor.commands.setTextSelection(pos);
      editor.commands.keyboardShortcut('Mod-/');
    });
    return screen.findByRole('menu', { name: 'Block' });
  }

  it('offers every action with its keys, Move up disabled on the first block', async () => {
    const { editor } = await openNote('First.\n\nSecond.\n');
    const menu = await menuAt(editor, 1);
    const rows = within(menu).getAllByRole('menuitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Turn into callout',
      'Add block above⌥⇧↩',
      'Add block below⌥↩',
      'Duplicate⌘D',
      'Move up⇧⌘↑',
      'Move down⇧⌘↓',
      'Delete⇧⌘⌫',
    ]);
    expect(within(menu).getByRole('menuitem', { name: /Move up/ })).toHaveAttribute(
      'data-disabled',
    );
    expect(within(menu).getByRole('menuitem', { name: /Move down/ })).not.toHaveAttribute(
      'data-disabled',
    );
  });

  it('adds a block below, where typing `## ` makes a heading that is saved as one', async () => {
    const { editor, services } = await openNote('First.\n\nSecond.\n');
    const menu = await menuAt(editor, 1);
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Add block below/ }));
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Block' })).toBeNull());
    act(() => {
      const { view } = editor;
      for (const char of '## Next steps') {
        const { from, to } = view.state.selection;
        const handled = view.someProp('handleTextInput', (handle) =>
          handle(view, from, to, char, () => view.state.tr.insertText(char, from, to)),
        );
        if (handled !== true) view.dispatch(view.state.tr.insertText(char, from, to));
      }
    });
    await savedAs(services, 'First.\n\n## Next steps\n\nSecond.\n');
  });

  it('duplicates, moves down and deletes the block from its rows', async () => {
    const { editor, services } = await openNote('First *one*.\n\n* fern\n* moss\n');
    await userEvent.click(
      within(await menuAt(editor, 1)).getByRole('menuitem', { name: /Duplicate/ }),
    );
    await savedAs(services, 'First *one*.\n\nFirst *one*.\n\n* fern\n* moss\n');
    await userEvent.click(
      within(await menuAt(editor, 1)).getByRole('menuitem', { name: /Delete/ }),
    );
    await savedAs(services, 'First *one*.\n\n* fern\n* moss\n');
    await userEvent.click(
      within(await menuAt(editor, 1)).getByRole('menuitem', { name: /Move down/ }),
    );
    await savedAs(services, '* fern\n* moss\n\nFirst *one*.\n');
  });

  it('deletes a list item from its row, the list rewritten without it', async () => {
    const { editor, services } = await openNote('Intro.\n\n- fern\n- moss\n');
    await userEvent.click(
      within(await menuAt(editor, 'Intro.'.length + 5)).getByRole('menuitem', { name: /Delete/ }),
    );
    await savedAs(services, 'Intro.\n\n- moss\n');
  });

  it('is answered by its keys: arrows move through the rows, Enter runs one, Escape closes', async () => {
    const { editor, services } = await openNote('First.\n\nSecond.\n');
    const menu = await menuAt(editor, 1);
    await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement));
    await userEvent.keyboard('{ArrowDown}');
    const highlighted = () => menu.querySelector('[data-highlighted]')?.textContent;
    await waitFor(() => expect(highlighted()).toBe('Turn into callout'));
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(highlighted()).toBe('Add block above⌥⇧↩'));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await waitFor(() => expect(highlighted()).toBe('Duplicate⌘D'));
    await userEvent.keyboard('{Enter}');
    await savedAs(services, 'First.\n\nFirst.\n\nSecond.\n');
    await menuAt(editor, 1);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Block' })).toBeNull());
    await waitFor(() => expect(editor.view.dom).toHaveFocus());
  });
});
