import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { applyExternalChanges } from '../application/index.ts';
import type { MemoryVaultFiles } from '../application/testing/index.ts';
import type { VaultPath } from '../domain/vault/index.ts';
import { memoryLayoutStorage } from '../ui/panes/layout-storage.ts';
import { giveElementsASize, renderApp, TEST_VAULT } from '../ui/testing/render-app.tsx';
import { loadMarkdown } from './app-boot.ts';

/*
 * The note editor in the app, on the real markdown reader and writer: what
 * the person sees, and what typing in it writes to the file.
 */

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

// jsdom lays nothing out: ProseMirror asks a range for its boxes to scroll the caret into view.
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

async function openInEditor(files: Readonly<Record<VaultPath, string>>, path: VaultPath) {
  const app = await renderApp({ files, source: false, loadMarkdown });
  await go(`#/note/${encodeURIComponent(path)}`);
  const text = await screen.findByRole('textbox', { name: 'Note text' }, { timeout: 8000 });
  return { ...app, text, editor: editorOf(text) };
}

/** The TipTap editor behind the note's text, which TipTap keeps on its element. */
function editorOf(element: HTMLElement): Editor {
  const editor = (element as HTMLElement & { editor?: Editor }).editor;
  if (editor === undefined) throw new Error('No editor on the note’s text.');
  return editor;
}

/**
 * Types `text` as a keyboard would: each character offered to the input
 * rules first (`## `, `**bold**`), as ProseMirror does on a keystroke.
 */
function type(editor: Editor, text: string): void {
  act(() => {
    for (const char of text) {
      const { view } = editor;
      const { from, to } = view.state.selection;
      const handled = view.someProp('handleTextInput', (handle) =>
        handle(view, from, to, char, () => view.state.tr.insertText(char, from, to)),
      );
      if (handled !== true) view.dispatch(view.state.tr.insertText(char, from, to));
    }
  });
}

const press = (editor: Editor, key: string) =>
  act(() => {
    editor.commands.keyboardShortcut(key);
  });

const toEnd = (editor: Editor) =>
  act(() => {
    editor.commands.focus('end');
  });

async function savedAs(
  services: { session: { file(path: VaultPath): { text: string } | null } },
  path: VaultPath,
  text: string,
) {
  await waitFor(() => expect(services.session.file(path)?.text).toBe(text), { timeout: 3000 });
}

describe('a note in the editor', () => {
  it('reads as it renders: no markdown characters, a heading, bold, a link, a tag and a checkbox', async () => {
    const { text } = await openInEditor(
      {
        [PLAN]:
          '## Cut-over\n\nThe **parallel run** with [[Mara Quill]]. #project\n\n- [ ] Call Mara\n',
      },
      PLAN,
    );
    expect(within(text).getByRole('heading', { level: 2, name: 'Cut-over' })).toBeInTheDocument();
    expect(text.querySelector('strong')).toHaveTextContent('parallel run');
    expect(within(text).getByRole('link', { name: 'Mara Quill' })).toHaveClass('wikilink');
    expect(text.querySelector('.tag')).toHaveTextContent('#project');
    expect(within(text).getByRole('checkbox')).not.toBeChecked();
    expect(text.textContent).not.toMatch(/##|\*\*|\[\[|- \[ \]/);
  });

  it('writes a heading and bold typed with markdown shortcuts, and keeps the rest as it was', async () => {
    const original = 'Hello.  Two spaces kept.\n\n* a star bullet\n\nEnd.\n';
    const { editor, services } = await openInEditor({ [PLAN]: original }, PLAN);
    toEnd(editor);
    press(editor, 'Enter');
    type(editor, '## Title');
    press(editor, 'Enter');
    type(editor, 'Some **bold**');
    await savedAs(services, PLAN, `${original}\n## Title\n\nSome **bold**\n`);
    expect(editor.view.dom.querySelector('h2')).toHaveTextContent('Title');
    expect(editor.view.dom.querySelector('strong')).toHaveTextContent('bold');
  });

  it('ticks a task box and writes only the tick', async () => {
    const original = '# Week\n\n- [ ] Call Mara\n- [ ] Send the plan\n\nNotes  after.\n';
    const { text, services } = await openInEditor({ [PLAN]: original }, PLAN);
    const [first] = within(text).getAllByRole('checkbox');
    fireEvent.click(first!);
    await savedAs(services, PLAN, original.replace('- [ ] Call', '- [x] Call'));
  });

  it('writes a wiki link and a tag typed in as they read, never escaped', async () => {
    const { editor, services } = await openInEditor({ [PLAN]: 'Plan.\n' }, PLAN);
    toEnd(editor);
    type(editor, ' See [[Mara Quill]] #project');
    await savedAs(services, PLAN, 'Plan. See [[Mara Quill]] #project\n');
  });

  it('shows a block it cannot edit as its source, and saves it unchanged', async () => {
    const original =
      'Before.\n\n<details>\n<summary>More</summary>\n\nHidden.\n</details>\n\n[^1]: A footnote.\n';
    const { text, editor, services } = await openInEditor({ [PLAN]: original }, PLAN);
    expect(text.querySelector('.raw-block')).toHaveTextContent('<details>');
    act(() => {
      editor.commands.setTextSelection(3);
    });
    type(editor, 'X');
    await savedAs(services, PLAN, original.replace('Before.', 'BeXfore.'));
  });

  it('keeps a frontmatter block the note still has, byte for byte, outside the editor', async () => {
    const original = '---\ntags: [old]\ncreated: 2024-01-02\n---\nBody.\n';
    const { editor, services } = await openInEditor({ [PLAN]: original }, PLAN);
    expect(screen.getByTitle('Frontmatter — saved unchanged')).toHaveTextContent('tags: [old]');
    toEnd(editor);
    type(editor, ' More.');
    await savedAs(services, PLAN, '---\ntags: [old]\ncreated: 2024-01-02\n---\nBody. More.\n');
  });
});

describe('following a link in the editor', () => {
  it('creates the note a link names when none answers, and opens it', async () => {
    const user = userEvent.setup();
    const { services } = await openInEditor(TEST_VAULT, 'Projects/Garden shed.md');
    await user.click(screen.getByRole('link', { name: 'Materials list' }));
    expect(await screen.findByRole('textbox', { name: 'Note title' })).toHaveValue(
      'Materials list',
    );
    expect(services.session.file('Inbox/Materials list.md')).not.toBeNull();
    expect(window.location.hash).toBe('#/note/Inbox%2FMaterials%20list.md');
  });
});

describe('a note open in two panes', () => {
  const tab = (id: string) => ({
    tabs: [{ id, view: { kind: 'note' as const, path: PLAN }, source: false }],
    activeTab: id,
  });
  const split = () =>
    memoryLayoutStorage({ panes: [tab('t1'), tab('t2')], activePane: 0, split: 0.5, nextId: 3 });

  async function openTwice(original: string) {
    const app = await renderApp({
      files: { [PLAN]: original },
      source: false,
      loadMarkdown,
      layout: split(),
    });
    await waitFor(() =>
      expect(screen.getAllByRole('textbox', { name: 'Note text' })).toHaveLength(2),
    );
    const [left, right] = screen.getAllByRole('textbox', { name: 'Note text' }).map(editorOf);
    return { ...app, left: left!, right: right! };
  }

  it('shows what is typed in one pane in the other, and saves it once', async () => {
    const { left, right, services } = await openTwice('First.\n\nSecond.\n');
    act(() => {
      right.commands.setTextSelection(right.state.doc.content.size - 1);
    });
    const caret = right.state.selection.head;
    act(() => {
      left.commands.setTextSelection(1);
    });
    type(left, 'Very ');
    expect(right.getText()).toContain('Very First.');
    // The other pane's caret was after the typing: it moves along with its words.
    expect(right.state.selection.head).toBe(caret + 'Very '.length);
    await savedAs(services, PLAN, 'Very First.\n\nSecond.\n');
  });

  it('takes a change made on disk in both panes, keeping the untouched blocks', async () => {
    const { left, right, services } = await openTwice('First.\n\nSecond.\n');
    const untouched = left.view.dom.querySelector('p');
    (services.files as MemoryVaultFiles).edit(PLAN, 'First.\n\nSecond, edited by Claude.\n');
    await act(() => applyExternalChanges(services, [PLAN]));
    expect(left.getText()).toContain('Second, edited by Claude.');
    expect(right.getText()).toContain('Second, edited by Claude.');
    // The first paragraph was not drawn again: the page does not jump.
    expect(left.view.dom.querySelector('p')).toBe(untouched);
  });

  it('keeps untouched blocks’ bytes after the markdown view beside an editor turns into an editor', async () => {
    const original = 'Intro.\n\n* star item\n\nSome __strong__ words.\n';
    const layout = memoryLayoutStorage({
      panes: [
        { tabs: [{ id: 't1', view: { kind: 'note', path: PLAN }, source: true }], activeTab: 't1' },
        {
          tabs: [{ id: 't2', view: { kind: 'note', path: PLAN }, source: false }],
          activeTab: 't2',
        },
      ],
      activePane: 0,
      split: 0.5,
      nextId: 3,
    });
    const { services } = await renderApp({
      files: { [PLAN]: original },
      source: false,
      loadMarkdown,
      layout,
    });
    const right = editorOf(
      await screen.findByRole('textbox', { name: 'Note text' }, { timeout: 8000 }),
    );
    await screen.findByRole('textbox', { name: 'Note markdown' });
    // A paragraph added at the top: every block after it moves down one place.
    act(() => {
      right.commands.insertContentAt(0, {
        type: 'paragraph',
        content: [{ type: 'text', text: 'New top.' }],
      });
    });
    await savedAs(services, PLAN, `New top.\n\n${original}`);
    // The left pane goes from the markdown to the editor, while the right one stays.
    await act(async () => {
      screen.getAllByRole('button', { name: 'Markdown' })[0]!.click();
    });
    await waitFor(() =>
      expect(screen.getAllByRole('textbox', { name: 'Note text' })).toHaveLength(2),
    );
    act(() => {
      // At the end of `Intro.`, after the new first paragraph.
      right.commands.insertContentAt(right.state.doc.child(0).nodeSize + 1 + 'Intro.'.length, 'Z');
    });
    await savedAs(services, PLAN, `New top.\n\nIntro.Z\n\n* star item\n\nSome __strong__ words.\n`);
  });
});
