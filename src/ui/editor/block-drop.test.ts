// @vitest-environment jsdom
/**
 * Where a block dragged within its note lands: the rules of `plannedDrop`,
 * and the drop as the editor makes it. Lifted from DFAI's block-drop tests,
 * without its highlights and tombstones. Fictional data only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { createEditorExtensions } from './extensions.ts';
import { BLOCK_DRAG_TYPE, plannedDrop } from './block-drop.ts';

const RAW = '<div class="larkspur">Raw</div>';

const text = (words: string): JSONContent => ({ type: 'text', text: words });
const paragraph = (words: string): JSONContent => ({ type: 'paragraph', content: [text(words)] });
const heading = (words: string): JSONContent => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [text(words)],
});
const raw = (markdown: string): JSONContent => ({ type: 'rawBlock', attrs: { markdown } });
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
const bullets = (...items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items });
const numbered = (...items: JSONContent[]): JSONContent => ({
  type: 'orderedList',
  attrs: { start: 1 },
  content: items,
});
const cell = (...content: JSONContent[]): JSONContent => ({ type: 'tableCell', content });
const row = (...cells: JSONContent[]): JSONContent => ({ type: 'tableRow', content: cells });
const table = (...rows: JSONContent[]): JSONContent => ({ type: 'table', content: rows });

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function noteOf(...content: JSONContent[]): Editor {
  editor = new Editor({
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
    content: { type: 'doc', content },
  });
  editor.view.dispatch(editor.state.tr);
  return editor;
}

/** Where the textblock reading `words` starts its text. */
function textAt(instance: Editor, words: string): number {
  let at = -1;
  instance.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isTextblock && node.textContent === words) at = pos + 1;
    return at === -1;
  });
  if (at === -1) throw new Error(`No block reads “${words}”.`);
  return at;
}

/** The top-level block satisfying `which`, selected whole. */
function blockSelection(
  instance: Editor,
  which: (node: ProseMirrorNode) => boolean,
): NodeSelection {
  let at = -1;
  instance.state.doc.forEach((node, offset) => {
    if (at === -1 && which(node)) at = offset;
  });
  if (at === -1) throw new Error('No such block.');
  return NodeSelection.create(instance.state.doc, at);
}

const isRaw = (markdown: string) => (node: ProseMirrorNode) =>
  node.type.name === 'rawBlock' && node.attrs['markdown'] === markdown;

/** The outline of the note: each block's type, its children's in brackets. */
function outline(node: ProseMirrorNode): string {
  if (node.isTextblock || node.isAtom)
    return `${node.type.name}${node.isTextblock ? `(${node.textContent})` : ''}`;
  const children: string[] = [];
  node.forEach((child) => children.push(outline(child)));
  return `${node.type.name}[${children.join(' ')}]`;
}
const outlines = (instance: Editor): string[] => {
  const out: string[] = [];
  instance.state.doc.forEach((node) => out.push(outline(node)));
  return out;
};

/** A drop event at the editor, carrying `types` and their data. */
function dropEvent({ copy, data }: { copy: boolean; data: Record<string, string> }): Event {
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(drop, {
    clientX: 0,
    clientY: 0,
    // The copy key is Alt on a Mac, Ctrl elsewhere: jsdom is "elsewhere", so both are held.
    altKey: copy,
    ctrlKey: copy,
    dataTransfer: {
      getData: (type: string) => data[type] ?? '',
      types: Object.keys(data),
      files: [],
    },
  });
  return drop;
}

/** Drags `selection` as the handle drags it; `drop` lets it go at `pos`. */
function startDrag(instance: Editor, selection: NodeSelection, { copy = false } = {}) {
  const { view } = instance;
  view.dispatch(instance.state.tr.setSelection(selection));
  (view as unknown as { dragging: unknown }).dragging = {
    slice: selection.content(),
    move: !copy,
    node: selection,
  };
  return {
    drop: (pos: number) => {
      view.posAtCoords = () => ({ pos, inside: -1 });
      view.dom.dispatchEvent(dropEvent({ copy, data: {} }));
    },
  };
}

/** Drops `selection`, dragged as the handle drags it, at `pos`, moved or copied with the key. */
function dragTo(
  instance: Editor,
  selection: NodeSelection,
  pos: number,
  { copy = false }: { copy?: boolean } = {},
): void {
  startDrag(instance, selection, { copy }).drop(pos);
}

describe('a drop into a table cell', () => {
  const note = () =>
    noteOf(
      paragraph('Water the ferns.'),
      heading('Beds'),
      table(row(cell(paragraph('North')), cell(paragraph('Fern')))),
    );

  it('takes a paragraph: the cell is a line of text, and the paragraph joins it', () => {
    const instance = note();
    const intoCell = textAt(instance, 'North') + 'North'.length;
    dragTo(
      instance,
      blockSelection(instance, (node) => node.textContent === 'Water the ferns.'),
      intoCell,
    );
    expect(outlines(instance)).toEqual([
      'heading(Beds)',
      'table[tableRow[tableCell[paragraph(North) paragraph(Water the ferns.)] tableCell[paragraph(Fern)]]]',
      'paragraph()',
    ]);
  });

  it('refuses a heading, and the note is as it was', () => {
    const instance = note();
    const before = instance.state.doc;
    const intoCell = textAt(instance, 'North') + 'North'.length;
    dragTo(
      instance,
      blockSelection(instance, (node) => node.type.name === 'heading'),
      intoCell,
    );
    expect(instance.state.doc.eq(before)).toBe(true);
  });

  it('refuses a table dropped into a cell of another', () => {
    const instance = noteOf(
      table(row(cell(paragraph('North')))),
      table(row(cell(paragraph('South')))),
    );
    const before = instance.state.doc;
    const intoCell = textAt(instance, 'North') + 'North'.length;
    dragTo(
      instance,
      blockSelection(instance, (node) => node.textContent === 'South'),
      intoCell,
    );
    expect(instance.state.doc.eq(before)).toBe(true);
  });
});

describe('a raw block dropped into a container', () => {
  it('lands at the top level after the list, where it was dropped in the list’s last item', () => {
    const instance = noteOf(
      raw(RAW),
      bullets(item(paragraph('Water.')), item(paragraph('Repot.'))),
      paragraph('After.'),
    );
    const intoItem = textAt(instance, 'Repot.') + 'Repot.'.length;
    dragTo(instance, blockSelection(instance, isRaw(RAW)), intoItem);
    expect(outlines(instance)).toEqual([
      'bulletList[listItem[paragraph(Water.)] listItem[paragraph(Repot.)]]',
      'rawBlock',
      'paragraph(After.)',
    ]);
    expect(instance.state.doc.child(1).attrs['markdown']).toBe(RAW);
  });

  it('lands before the quote it was dropped at the start of', () => {
    const instance = noteOf(
      paragraph('Before.'),
      { type: 'blockquote', content: [paragraph('Quoted words here.')] },
      raw(RAW),
    );
    const intoQuote = textAt(instance, 'Quoted words here.');
    dragTo(instance, blockSelection(instance, isRaw(RAW)), intoQuote);
    expect(outlines(instance).slice(0, 3)).toEqual([
      'paragraph(Before.)',
      'rawBlock',
      'blockquote[paragraph(Quoted words here.)]',
    ]);
  });
});

describe('a list item dragged out of its list', () => {
  it('from a numbered list to the top level is still numbered', () => {
    const instance = noteOf(
      numbered(item(paragraph('Sow.')), item(paragraph('Water.'))),
      paragraph('After.'),
    );
    const itemAt = textAt(instance, 'Water.') - 2;
    dragTo(
      instance,
      NodeSelection.create(instance.state.doc, itemAt),
      instance.state.doc.content.size,
    );
    expect(outlines(instance)).toEqual([
      'orderedList[listItem[paragraph(Sow.)]]',
      'paragraph(After.)',
      'orderedList[listItem[paragraph(Water.)]]',
      'paragraph()',
    ]);
  });

  it('into another list joins that list as one of its items', () => {
    const instance = noteOf(
      numbered(item(paragraph('Sow.')), item(paragraph('Water.'))),
      bullets(item(paragraph('Moss.'))),
    );
    const itemAt = textAt(instance, 'Water.') - 2;
    const afterMoss = textAt(instance, 'Moss.') + 'Moss.'.length + 2;
    dragTo(instance, NodeSelection.create(instance.state.doc, itemAt), afterMoss);
    expect(outlines(instance)).toEqual([
      'orderedList[listItem[paragraph(Sow.)]]',
      'bulletList[listItem[paragraph(Moss.)] listItem[paragraph(Water.)]]',
      'paragraph()',
    ]);
  });

  it('takes its nested list with it', () => {
    const instance = noteOf(
      bullets(
        item(paragraph('Beds.'), bullets(item(paragraph('North.')), item(paragraph('South.')))),
        item(paragraph('Pots.')),
      ),
      paragraph('After.'),
    );
    const itemAt = textAt(instance, 'Beds.') - 2;
    dragTo(
      instance,
      NodeSelection.create(instance.state.doc, itemAt),
      instance.state.doc.content.size,
    );
    expect(outlines(instance)).toEqual([
      'bulletList[listItem[paragraph(Pots.)]]',
      'paragraph(After.)',
      'bulletList[listItem[paragraph(Beds.) bulletList[listItem[paragraph(North.)] listItem[paragraph(South.)]]]]',
      'paragraph()',
    ]);
  });
});

describe('a block dropped on itself', () => {
  it('moved, leaves the note as it was, the only block too', () => {
    const instance = noteOf(paragraph('Only.'));
    const before = instance.state.doc;
    dragTo(instance, NodeSelection.create(instance.state.doc, 0), 3);
    expect(instance.state.doc.eq(before)).toBe(true);
  });

  it('copied with the key, is duplicated beside itself', () => {
    const instance = noteOf(paragraph('Only.'));
    dragTo(instance, NodeSelection.create(instance.state.doc, 0), 3, { copy: true });
    expect(outlines(instance)).toEqual(['paragraph(Only.)', 'paragraph(Only.)']);
  });
});

describe('a block that changed under the drag', () => {
  it('is followed to its new place when a line was added above it', () => {
    const instance = noteOf(paragraph('Fern.'), paragraph('Moss.'), paragraph('Last.'));
    const moss = blockSelection(instance, (node) => node.textContent === 'Moss.');
    const drag = startDrag(instance, moss);
    // The file changed mid-drag: a line was added above, so "Fern." now sits where "Moss." was.
    const added = instance.schema.nodeFromJSON(paragraph('New line.'));
    instance.view.dispatch(instance.state.tr.insert(0, added));
    drag.drop(instance.state.doc.content.size);
    expect(outlines(instance)).toEqual([
      'paragraph(New line.)',
      'paragraph(Fern.)',
      'paragraph(Last.)',
      'paragraph(Moss.)',
    ]);
  });

  it('is refused once a re-read made a new node of it, the caret elsewhere', () => {
    const instance = noteOf(paragraph('Fern.'), paragraph('Moss.'), paragraph('Last.'));
    const drag = startDrag(
      instance,
      blockSelection(instance, (node) => node.textContent === 'Fern.'),
    );
    // A re-read gives a kept block a new id, which makes a new node of it, and puts the caret back.
    const reread = instance.state.tr.setNodeAttribute(0, 'blockId', 'b9');
    reread.setSelection(TextSelection.create(reread.doc, textAt(instance, 'Last.')));
    instance.view.dispatch(reread);
    const before = instance.state.doc;
    drag.drop(instance.state.doc.content.size);
    expect(instance.state.doc.eq(before)).toBe(true);
  });
});

describe('the plan of a drop', () => {
  it('is null for a move onto the block itself', () => {
    const instance = noteOf(paragraph('A.'), paragraph('B.'));
    const selection = blockSelection(instance, (node) => node.textContent === 'A.');
    const planned = plannedDrop(instance.state.doc, {
      pos: 1,
      slice: selection.content(),
      dragged: selection,
      moved: true,
    });
    expect(planned).toBeNull();
  });
});

describe('a drop that did not begin in the note', () => {
  it('is left to the editor, which puts the text where it was dropped', () => {
    const instance = noteOf(paragraph('Fern.'), paragraph('Moss.'));
    const { view } = instance;
    view.posAtCoords = () => ({ pos: textAt(instance, 'Moss.'), inside: -1 });
    view.dom.dispatchEvent(dropEvent({ copy: false, data: { 'text/plain': 'From elsewhere. ' } }));
    expect(outlines(instance)).toEqual(['paragraph(Fern.)', 'paragraph(From elsewhere. Moss.)']);
  });

  it.each([
    ['a row of the folder tree', 'application/x-dfai-lite-entry'],
    ['a tab', 'application/x-dfai-lite-tab'],
  ])('changes nothing when it is %s', (_what, type) => {
    const instance = noteOf(paragraph('Fern.'), paragraph('Moss.'));
    const before = instance.state.doc;
    const { view } = instance;
    view.posAtCoords = () => ({ pos: textAt(instance, 'Moss.'), inside: -1 });
    view.dom.dispatchEvent(dropEvent({ copy: false, data: { [type]: 'Notes/Fern.md' } }));
    expect(instance.state.doc.eq(before)).toBe(true);
  });

  it('refuses a block dragged by the handle of another editor, and is no drop target for it', () => {
    const instance = noteOf(paragraph('Fern.'), paragraph('Moss.'));
    const before = instance.state.doc;
    const { view } = instance;
    view.posAtCoords = () => ({ pos: textAt(instance, 'Moss.'), inside: -1 });
    const data = { [BLOCK_DRAG_TYPE]: '', 'text/html': '<h2>Links</h2>', 'text/plain': 'Links' };
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.assign(over, { dataTransfer: { types: Object.keys(data) } });
    view.dom.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    view.dom.dispatchEvent(dropEvent({ copy: false, data }));
    expect(instance.state.doc.eq(before)).toBe(true);
  });
});
