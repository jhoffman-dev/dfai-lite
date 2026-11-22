// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { remarkMarkdown } from '../adapters/markdown/index.ts';
import type { EditorDocument } from '../domain/markdown/index.ts';
import { blockTargetAt } from '../ui/editor/block-actions.ts';
import { runBlockAction } from '../ui/editor/block-handle.ts';
import { editable } from '../ui/editor/editable-doc.ts';
import { createEditorExtensions } from '../ui/editor/extensions.ts';

/*
 * A block moved by its handle — dragged, or moved up from its menu — is the
 * same block, so the note is written back as the same blocks' bytes in the
 * new order: nothing the person did not move is rewritten, and blocks stand
 * a blank line apart. Through the real editor and the real writer. Every
 * name here is made up.
 */

const LIST = '* fern\n* moss';
const TABLE = '| Left | Right | Center |\n|:--|--:|:-:|\n| a | 1 | x |';
const RAW = '<div class="larkspur">\n  Raw <b>HTML</b>\n</div>';
const CODE = '```js\nconst cycle = 1;\n```';
const LAST = 'The *last* paragraph, with [[Mara Quill]].';
const BLOCKS = [CODE, RAW, TABLE, LIST, LAST];
const NOTE = `${BLOCKS.join('\n\n')}\n`;

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function open(text: string) {
  const note = remarkMarkdown.parseNote(text);
  const editor = new Editor({
    extensions: createEditorExtensions({
      suggest: () => [],
      onView: () => undefined,
      onSlashView: () => undefined,
      suggestTags: () => [],
      onTagView: () => undefined,
      onOpenTag: () => undefined,
      createNote: () => undefined,
      images: { loadImage: async () => null, embedImage: null },
    }),
    content: editable(note.parsed.doc) as object,
  });
  editors.push(editor);
  const save = () => remarkMarkdown.serializeNote(note, editor.getJSON() as EditorDocument);
  return { editor, save };
}

/** Where top-level block `index` starts. */
function startOf(editor: Editor, index: number): number {
  let pos = 0;
  for (let at = 0; at < index; at += 1) pos += editor.state.doc.child(at).nodeSize;
  return pos;
}

/** Drags top-level block `from` by its handle and lets it go just before block `before`. */
function drag(editor: Editor, { from, before }: { from: number; before: number }): void {
  const { view } = editor;
  const selection = NodeSelection.create(editor.state.doc, startOf(editor, from));
  view.dispatch(editor.state.tr.setSelection(selection));
  (view as unknown as { dragging: unknown }).dragging = {
    slice: selection.content(),
    move: true,
    node: selection,
  };
  const at = startOf(editor, before);
  view.posAtCoords = () => ({ pos: at, inside: -1 });
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(drop, {
    clientX: 0,
    clientY: 0,
    dataTransfer: { getData: () => '', types: [], files: [] },
  });
  view.dom.dispatchEvent(drop);
}

const inOrder = (...indexes: number[]) => `${indexes.map((at) => BLOCKS[at]).join('\n\n')}\n`;

describe('a block moved by its handle', () => {
  it('is written as its own bytes above the first block when dragged there, the others kept', () => {
    const { editor, save } = open(NOTE);
    drag(editor, { from: 2, before: 0 });
    expect(save()).toBe(inOrder(2, 0, 1, 3, 4));
  });

  it('keeps a code fence, a table and a starred list byte for byte through two drags', () => {
    const { editor, save } = open(NOTE);
    drag(editor, { from: 3, before: 0 });
    drag(editor, { from: 2, before: 4 });
    expect(save()).toBe(inOrder(3, 0, 2, 1, 4));
  });

  it('keeps its bytes when moved up from its menu, and back down', () => {
    const { editor, save } = open(NOTE);
    const target = blockTargetAt(editor.state.doc, {
      pos: startOf(editor, 3),
      inside: startOf(editor, 3),
    });
    if (target === null) throw new Error('No block.');
    expect(runBlockAction(editor.view, { target, action: 'moveUp' })).toBe(true);
    expect(save()).toBe(inOrder(0, 1, 3, 2, 4));
    const moved = blockTargetAt(editor.state.doc, {
      pos: startOf(editor, 2),
      inside: startOf(editor, 2),
    });
    if (moved === null) throw new Error('No block.');
    runBlockAction(editor.view, { target: moved, action: 'moveDown' });
    expect(save()).toBe(NOTE);
  });

  it('rewrites only its list when a list item moves within it, every other block kept', () => {
    // The list itself changed, so it is written afresh, with the writer's own
    // markers, as DFAI writes it; the blocks around it keep their bytes.
    const { editor, save } = open(`* fern\n* moss\n* lichen\n\n${TABLE}\n\n${RAW}\n`);
    const lichen = blockTargetAt(editor.state.doc, {
      pos: editor.state.doc.child(0).nodeSize - 4,
      inside: -1,
    });
    if (lichen === null) throw new Error('No item.');
    runBlockAction(editor.view, { target: lichen, action: 'moveUp' });
    expect(save()).toBe(`- fern\n- lichen\n- moss\n\n${TABLE}\n\n${RAW}\n`);
  });

  it('is written as the same bytes again when duplicated', () => {
    const { editor, save } = open(NOTE);
    const target = blockTargetAt(editor.state.doc, {
      pos: startOf(editor, 2),
      inside: startOf(editor, 2),
    });
    if (target === null) throw new Error('No block.');
    runBlockAction(editor.view, { target, action: 'duplicate' });
    expect(save()).toBe(inOrder(0, 1, 2, 2, 3, 4));
  });
});
