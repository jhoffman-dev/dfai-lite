import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { CALLOUTS_PATH, saveCalloutType } from '../application/index.ts';
import type { VaultPath } from '../domain/vault/index.ts';
import { giveElementsASize, renderApp } from '../ui/testing/render-app.tsx';
import { loadMarkdown } from './app-boot.ts';

/*
 * A callout's type from its block's menu, as Notion's: the menu of a
 * callout (or of a block inside one) has "Callout type", whose submenu
 * lists every type with the current one checked; picking one rewrites only
 * that callout's `[!kind]`. Another block can be turned into a callout, and
 * a callout unwrapped. A vault's own types are offered and drawn too.
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
const NOTE = 'Intro.\n\n> [!NOTE]- Read *this*\n>  * fern\n>  * moss\n\nLast.\n';

function editorOf(element: HTMLElement): Editor {
  const editor = (element as HTMLElement & { editor?: Editor }).editor;
  if (editor === undefined) throw new Error('No editor on the note’s text.');
  return editor;
}

async function openNote(files: Record<VaultPath, string>) {
  const app = await renderApp({ files, source: false, loadMarkdown });
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

/** Where the text `words` starts in the note. */
function posOf(editor: Editor, words: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(words)) found = pos + 1;
  });
  if (found < 0) throw new Error(`No “${words}” in the note.`);
  return found;
}

async function openTypes(menu: HTMLElement, name: string) {
  await userEvent.click(within(menu).getByRole('menuitem', { name }));
  return screen.findByRole('menu', { name });
}

const savedText = (app: {
  services: { session: { file(path: VaultPath): { text: string } | null } };
}) => app.services.session.file(PLAN)?.text;

describe('a callout’s block menu', () => {
  it('offers “Callout type” on a callout, even with the caret in a list inside it', async () => {
    const app = await openNote({ [PLAN]: NOTE });
    const menu = await menuAt(app.editor, posOf(app.editor, 'moss'));
    const rows = within(menu)
      .getAllByRole('menuitem')
      .map((row) => row.textContent);
    expect(rows.slice(0, 2)).toEqual(['Callout type', 'Remove callout']);
    expect(rows).not.toContain('Turn into callout');
  });

  it('checks the current type, and a pick rewrites only that callout’s first line', async () => {
    const app = await openNote({ [PLAN]: NOTE });
    const menu = await menuAt(app.editor, posOf(app.editor, 'fern'));
    const types = await openTypes(menu, 'Callout type');
    expect(within(types).getByRole('menuitemradio', { name: 'Note' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(within(types).getByRole('menuitemradio', { name: 'Warning' }));
    await waitFor(() => expect(savedText(app)).toBe(NOTE.replace('[!NOTE]', '[!warning]')));
    const callout = app.editor.view.dom.querySelector('.callout');
    expect(callout).toHaveAttribute('data-callout', 'warning');
    expect(callout).toHaveAttribute('data-hue', 'orange');
    expect(screen.queryByRole('menu', { name: 'Block' })).toBeNull();
  });

  it('turns a paragraph into a callout of the type picked, and removes it again', async () => {
    const app = await openNote({ [PLAN]: 'Intro.\n\nLast.\n' });
    const menu = await menuAt(app.editor, posOf(app.editor, 'Last'));
    const rows = within(menu)
      .getAllByRole('menuitem')
      .map((row) => row.textContent);
    expect(rows).not.toContain('Callout type');
    const types = await openTypes(menu, 'Turn into callout');
    await userEvent.click(within(types).getByRole('menuitemradio', { name: 'Tip' }));
    await waitFor(() => expect(savedText(app)).toBe('Intro.\n\n> [!tip]\n> Last.\n'));

    const again = await menuAt(app.editor, posOf(app.editor, 'Last'));
    await userEvent.click(within(again).getByRole('menuitem', { name: 'Remove callout' }));
    await waitFor(() => expect(savedText(app)).toBe('Intro.\n\nLast.\n'));
  });

  it('keeps a callout’s title as a paragraph when it is removed', async () => {
    const app = await openNote({ [PLAN]: '> [!tip] Heads up\n> Body.\n' });
    const menu = await menuAt(app.editor, posOf(app.editor, 'Body'));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Remove callout' }));
    await waitFor(() => expect(savedText(app)).toBe('Heads up\n\nBody.\n'));
  });

  it('offers the vault’s own types, draws them in their hue, and follows a new one', async () => {
    const app = await openNote({ [PLAN]: '> [!Decision] Ship\n> Friday.\n' });
    const callout = () => app.editor.view.dom.querySelector('.callout');
    expect(callout()).toHaveAttribute('data-callout-source', 'unknown');
    expect(callout()).toHaveAttribute('data-hue', 'gray');

    await act(() =>
      saveCalloutType(app.services, {
        draft: { name: 'decision', label: 'Decision', hue: 'purple', icon: 'flag' },
        replacing: null,
      }),
    );
    expect(app.services.session.file(CALLOUTS_PATH)?.text).toContain('"decision"');
    await waitFor(() => expect(callout()).toHaveAttribute('data-hue', 'purple'));
    expect(callout()).toHaveAttribute('data-callout-source', 'custom');

    const menu = await menuAt(app.editor, posOf(app.editor, 'Friday'));
    const types = await openTypes(menu, 'Callout type');
    expect(within(types).getByRole('menuitemradio', { name: 'Decision' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(within(types).getByRole('menuitemradio', { name: 'Bug' }));
    await waitFor(() => expect(savedText(app)).toBe('> [!bug] Ship\n> Friday.\n'));
  });
});
