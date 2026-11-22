// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { remarkMarkdown } from '../adapters/markdown/index.ts';
import type { EditorDocument } from '../domain/markdown/index.ts';
import { blockTargetAt, blockTargetOfSelection } from '../ui/editor/block-actions.ts';
import { runBlockAction } from '../ui/editor/block-handle.ts';
import { editable } from '../ui/editor/editable-doc.ts';
import { createEditorExtensions } from '../ui/editor/extensions.ts';
import type { EmbedImage } from '../ui/editor/image-uploads.ts';

/*
 * A picture and the block handle, as in DFAI: the paragraph a picture is in
 * is the block the handle moves, duplicates and deletes, its bytes — size
 * and all — kept; a block dropped on a picture lands beside its paragraph,
 * never in it; and a file dropped from Finder is a picture to save, never
 * taken for a block drag. Through the real editor and the real writer.
 */

const IMAGE = '![Pay runs|400](<../attachments/Pay runs.png> "Q3")';
const INTRO = 'How the pay runs *compare*.';
const AFTER = '* fern\n* moss';
const NOTE = `${INTRO}\n\n${IMAGE}\n\n${AFTER}\n`;

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function open(text: string, embedImage: EmbedImage | null = null) {
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
      images: { loadImage: async () => null, embedImage },
    }),
    content: editable(note.parsed.doc) as object,
  });
  editors.push(editor);
  const save = () => remarkMarkdown.serializeNote(note, editor.getJSON() as EditorDocument);
  return { editor, save };
}

const startOf = (editor: Editor, index: number) => {
  let pos = 0;
  for (let at = 0; at < index; at += 1) pos += editor.state.doc.child(at).nodeSize;
  return pos;
};

/** A drop event at `pos`, carrying `files` (from Finder) or none (a block drag). */
function dropAt(editor: Editor, pos: number, files: File[] = []): Event {
  editor.view.posAtCoords = () => ({ pos, inside: -1 });
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(drop, {
    clientX: 0,
    clientY: 0,
    dataTransfer: {
      getData: () => '',
      types: files.length > 0 ? ['Files'] : [],
      files,
    },
  });
  editor.view.dom.dispatchEvent(drop);
  return drop;
}

/** Drags top-level block `from` by its handle, as the handle starts a drag. */
function dragBlock(editor: Editor, from: number): void {
  const { view } = editor;
  const selection = NodeSelection.create(editor.state.doc, startOf(editor, from));
  view.dispatch(editor.state.tr.setSelection(selection));
  (view as unknown as { dragging: unknown }).dragging = {
    slice: selection.content(),
    move: true,
    node: selection,
  };
}

describe('a picture and the block handle', () => {
  it('attaches the handle to the picture’s paragraph, from the picture or a selection of it', () => {
    const { editor } = open(NOTE);
    const imageAt = startOf(editor, 1) + 1;
    const target = blockTargetAt(editor.state.doc, { pos: imageAt, inside: imageAt });
    expect(target?.pos).toBe(startOf(editor, 1));
    expect(target?.node.firstChild?.type.name).toBe('image');
    editor.commands.setNodeSelection(imageAt);
    expect(blockTargetOfSelection(editor.state)?.pos).toBe(startOf(editor, 1));
  });

  it('drags the picture’s block, keeping every byte of it, its size and title too', () => {
    const { editor, save } = open(NOTE);
    dragBlock(editor, 1);
    dropAt(editor, startOf(editor, 0));
    expect(save()).toBe(`${IMAGE}\n\n${INTRO}\n\n${AFTER}\n`);
  });

  it('duplicates, moves and deletes it from the block menu, its bytes kept', () => {
    const { editor, save } = open(NOTE);
    const at = () => blockTargetAt(editor.state.doc, { pos: startOf(editor, 1) + 1, inside: -1 })!;
    runBlockAction(editor.view, { target: at(), action: 'duplicate' });
    expect(save()).toBe(`${INTRO}\n\n${IMAGE}\n\n${IMAGE}\n\n${AFTER}\n`);
    runBlockAction(editor.view, { target: at(), action: 'delete' });
    expect(save()).toBe(NOTE);
    runBlockAction(editor.view, { target: at(), action: 'moveUp' });
    expect(save()).toBe(`${IMAGE}\n\n${INTRO}\n\n${AFTER}\n`);
  });

  it('lands a block dropped on the picture beside its paragraph, never inside it', () => {
    const { editor, save } = open(NOTE);
    dragBlock(editor, 0);
    // Onto the picture itself: the point inside its paragraph.
    dropAt(editor, startOf(editor, 1) + 1);
    const holder = [...Array(editor.state.doc.childCount).keys()]
      .map((index) => editor.state.doc.child(index))
      .find((block) => block.firstChild?.type.name === 'image');
    expect(holder?.childCount).toBe(1);
    expect([`${IMAGE}\n\n${INTRO}\n\n${AFTER}\n`, NOTE]).toContain(save());
  });
});

describe('a drop onto the note', () => {
  it('saves a file from Finder as a picture, and is not taken for a block drag', async () => {
    const embed = vi.fn<EmbedImage>(async () => ({ src: '../attachments/shot.png', alt: 'shot' }));
    const { editor, save } = open(NOTE, embed);
    const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' });
    const drop = dropAt(editor, startOf(editor, 0) + 1, [file]);
    expect(drop.defaultPrevented).toBe(true);
    expect(embed).toHaveBeenCalledWith(file, 'file');
    await vi.waitFor(() => expect(save()).toContain('![shot](../attachments/shot.png)'));
    expect(save()).toContain(`\n\n${IMAGE}\n\n`);
  });

  it('moves a block dragged by its handle, and saves no file', () => {
    const embed = vi.fn<EmbedImage>();
    const { editor, save } = open(NOTE, embed);
    dragBlock(editor, 1);
    dropAt(editor, startOf(editor, 3));
    expect(embed).not.toHaveBeenCalled();
    expect(save()).toBe(`${INTRO}\n\n${AFTER}\n\n${IMAGE}\n`);
  });
});
