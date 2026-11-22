// @vitest-environment jsdom
/**
 * A block's handle actions on a real editor, with every plugin the note has:
 * what each does to paragraphs, headings, list items, a raw block and an
 * image, and that one undo puts the note back exactly as it was. Lifted from
 * DFAI's block-actions tests, without its highlights, tombstones and `^id`
 * anchors (Lite keeps `^id` as the text it is). Fictional data only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { createEditorExtensions } from './extensions.ts';
import { blockChange, blockTargetAt, type BlockAction, type BlockTarget } from './block-actions.ts';
import { availableBlockActions, runBlockAction } from './block-handle.ts';

const RAW = '<div class="larkspur">Raw</div>';

const text = (words: string): JSONContent => ({ type: 'text', text: words });
const paragraph = (words: string): JSONContent => ({ type: 'paragraph', content: [text(words)] });
const heading = (words: string): JSONContent => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [text(words)],
});
const item = (type: 'listItem' | 'taskItem', words: string): JSONContent => ({
  type,
  ...(type === 'taskItem' && { attrs: { checked: true } }),
  content: [paragraph(words)],
});
const bullets = (...words: string[]): JSONContent => ({
  type: 'bulletList',
  content: words.map((each) => item('listItem', each)),
});
const tasks = (...words: string[]): JSONContent => ({
  type: 'taskList',
  content: words.map((each) => item('taskItem', each)),
});
const raw = (markdown: string): JSONContent => ({ type: 'rawBlock', attrs: { markdown } });
const withImage = (words: string): JSONContent => ({
  type: 'paragraph',
  content: [text(words), { type: 'image', attrs: { src: 'fern.png', alt: 'A fern' } }],
});

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
  return editor;
}

/** The block a handle beside the textblock reading `words` acts on. */
function targetOf(instance: Editor, words: string): BlockTarget {
  let at = -1;
  instance.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isTextblock && node.textContent === words) at = pos + 1;
    return at === -1;
  });
  const target = blockTargetAt(instance.state.doc, { pos: at, inside: -1 });
  if (target === null) throw new Error(`No block reads “${words}”.`);
  return target;
}

/** The raw block with this source, as the handle beside it finds it. */
function rawTarget(instance: Editor, markdown: string): BlockTarget {
  let at = -1;
  instance.state.doc.forEach((node, pos) => {
    if (node.type.name === 'rawBlock' && node.attrs['markdown'] === markdown) at = pos;
  });
  const target = blockTargetAt(instance.state.doc, { pos: at, inside: at });
  if (target === null) throw new Error('No such raw block.');
  return target;
}

/** Does `action` and answers whether it changed the note. */
function act(instance: Editor, target: BlockTarget, action: BlockAction): boolean {
  const change = blockChange(instance.state, { target, action });
  if (change === null) return false;
  instance.view.dispatch(change);
  return true;
}

/** Each block of the note, as a line: its type and words or source. */
function blocks(instance: Editor): string[] {
  const lines: string[] = [];
  instance.state.doc.descendants((node) => {
    if (!node.isTextblock && node.type.name !== 'rawBlock') return true;
    const words = node.type.name === 'rawBlock' ? String(node.attrs['markdown']) : node.textContent;
    lines.push(`${node.type.name}:${words}`);
    return false;
  });
  return lines;
}

/** The textblock the caret is in. */
const caretBlock = (instance: Editor) => instance.state.selection.$head.parent;

describe('the block a handle acts on', () => {
  it('is the list item, not its list, and the innermost of nested ones', () => {
    const instance = noteOf({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph('Outer.'), bullets('Inner.')] }],
    });
    expect(targetOf(instance, 'Inner.').node.textContent).toBe('Inner.');
    expect(targetOf(instance, 'Inner.').node.type.name).toBe('listItem');
    expect(targetOf(instance, 'Outer.').node.textContent).toBe('Outer.Inner.');
  });

  it('is the raw block itself, which a handle can act on as any block', () => {
    const instance = noteOf(paragraph('Above.'), raw(RAW));
    const at = instance.state.doc.child(0).nodeSize;
    expect(blockTargetAt(instance.state.doc, { pos: at, inside: at })?.node.type.name).toBe(
      'rawBlock',
    );
  });

  it('is a block of the note for a paragraph holding an image', () => {
    const instance = noteOf(withImage('Fern: '));
    const imageAt = 1 + 'Fern: '.length;
    const target = blockTargetAt(instance.state.doc, { pos: imageAt, inside: imageAt });
    expect(target?.node.type.name).toBe('paragraph');
  });

  it('is the whole table, not a cell of it', () => {
    const cell = { type: 'tableCell', content: [paragraph('North')] };
    const instance = noteOf(paragraph('A.'), {
      type: 'table',
      content: [{ type: 'tableRow', content: [cell] }],
    });
    expect(targetOf(instance, 'North').node.type.name).toBe('table');
  });
});

describe('Add block above and below', () => {
  it('puts an empty paragraph above a paragraph, the caret in it', () => {
    const instance = noteOf(paragraph('One.'), paragraph('Two.'));
    act(instance, targetOf(instance, 'Two.'), 'addAbove');
    expect(blocks(instance)).toEqual(['paragraph:One.', 'paragraph:', 'paragraph:Two.']);
    expect(caretBlock(instance).content.size).toBe(0);
    instance.commands.insertContent('Typed.');
    expect(blocks(instance)).toEqual(['paragraph:One.', 'paragraph:Typed.', 'paragraph:Two.']);
  });

  it('puts an empty paragraph below a heading, and typing lands in it', () => {
    const instance = noteOf(heading('Ferns'), paragraph('Body.'));
    act(instance, targetOf(instance, 'Ferns'), 'addBelow');
    instance.commands.insertContent('Typed.');
    expect(blocks(instance)).toEqual(['heading:Ferns', 'paragraph:Typed.', 'paragraph:Body.']);
  });

  it('puts an empty item of the same list beside a list item, a task unticked', () => {
    const instance = noteOf(bullets('One.', 'Two.'), tasks('Water.'));
    act(instance, targetOf(instance, 'One.'), 'addBelow');
    act(instance, targetOf(instance, 'Water.'), 'addAbove');
    const [list, taskList] = [instance.state.doc.child(0), instance.state.doc.child(1)];
    expect(list.childCount).toBe(3);
    expect(list.child(1).textContent).toBe('');
    expect(taskList.child(0).attrs['checked']).toBe(false);
    expect(caretBlock(instance).content.size).toBe(0);
  });

  it('puts the paragraph after a raw block', () => {
    const instance = noteOf(raw(RAW), paragraph('After.'));
    act(instance, rawTarget(instance, RAW), 'addBelow');
    expect(blocks(instance)).toEqual([`rawBlock:${RAW}`, 'paragraph:', 'paragraph:After.']);
  });
});

describe('Duplicate', () => {
  it('copies a paragraph after it, a `^id` in its text copied as the text it is', () => {
    const instance = noteOf(paragraph('Kept. ^keep01'), paragraph('Next.'));
    act(instance, targetOf(instance, 'Kept. ^keep01'), 'duplicate');
    expect(blocks(instance)).toEqual([
      'paragraph:Kept. ^keep01',
      'paragraph:Kept. ^keep01',
      'paragraph:Next.',
    ]);
  });

  it('copies a raw block as its source, unchanged, and selects the copy', () => {
    const instance = noteOf(raw(RAW), paragraph('End.'));
    act(instance, rawTarget(instance, RAW), 'duplicate');
    expect(blocks(instance)).toEqual([`rawBlock:${RAW}`, `rawBlock:${RAW}`, 'paragraph:End.']);
    expect(instance.state.selection).toBeInstanceOf(NodeSelection);
    expect(instance.state.selection.from).toBe(instance.state.doc.child(0).nodeSize);
  });

  it('copies a list item, a heading and a paragraph holding an image', () => {
    const instance = noteOf(heading('Ferns'), bullets('One.'), withImage('Fern: '));
    act(instance, targetOf(instance, 'Ferns'), 'duplicate');
    act(instance, targetOf(instance, 'One.'), 'duplicate');
    act(instance, targetOf(instance, 'Fern: '), 'duplicate');
    expect(blocks(instance)).toEqual([
      'heading:Ferns',
      'heading:Ferns',
      'paragraph:One.',
      'paragraph:One.',
      'paragraph:Fern: ',
      'paragraph:Fern: ',
      // The line kept to type on under a last picture (trailing-line.ts).
      'paragraph:',
    ]);
    expect(instance.state.doc.child(2).childCount).toBe(2);
    let images = 0;
    instance.state.doc.descendants((node) => {
      if (node.type.name === 'image') images += 1;
    });
    expect(images).toBe(2);
  });
});

describe('Move up and Move down', () => {
  it('swaps a paragraph with the block above, and back, the caret with it', () => {
    const instance = noteOf(heading('Ferns'), paragraph('Body.'), paragraph('End.'));
    const target = targetOf(instance, 'Body.');
    instance.view.dispatch(
      instance.state.tr.setSelection(TextSelection.create(instance.state.doc, target.pos + 3)),
    );
    act(instance, target, 'moveUp');
    expect(blocks(instance)).toEqual(['paragraph:Body.', 'heading:Ferns', 'paragraph:End.']);
    expect(instance.state.selection.head).toBe(3);
    act(instance, targetOf(instance, 'Body.'), 'moveDown');
    expect(blocks(instance)).toEqual(['heading:Ferns', 'paragraph:Body.', 'paragraph:End.']);
  });

  it('moves a list item within its list, and not past its ends', () => {
    const instance = noteOf(bullets('One.', 'Two.'), paragraph('End.'));
    act(instance, targetOf(instance, 'Two.'), 'moveUp');
    expect(blocks(instance)).toEqual(['paragraph:Two.', 'paragraph:One.', 'paragraph:End.']);
    expect(act(instance, targetOf(instance, 'Two.'), 'moveUp')).toBe(false);
    expect(act(instance, targetOf(instance, 'One.'), 'moveDown')).toBe(false);
  });

  it('moves a raw block as itself, its source and its id kept', () => {
    const instance = noteOf(paragraph('Mine.'), {
      type: 'rawBlock',
      attrs: { markdown: RAW, blockId: 'b1' },
    });
    act(instance, rawTarget(instance, RAW), 'moveUp');
    expect(blocks(instance)).toEqual([`rawBlock:${RAW}`, 'paragraph:Mine.']);
    expect(instance.state.doc.child(0).attrs['blockId']).toBe('b1');
  });

  it('up then down, and down then up, give the note back as it was', () => {
    const instance = noteOf(paragraph('A.'), raw(RAW), paragraph('B.'), paragraph('C.'));
    const before = instance.state.doc;
    act(instance, targetOf(instance, 'B.'), 'moveUp');
    act(instance, targetOf(instance, 'B.'), 'moveDown');
    expect(instance.state.doc.eq(before)).toBe(true);
    act(instance, targetOf(instance, 'A.'), 'moveDown');
    expect(blocks(instance)).toEqual([
      `rawBlock:${RAW}`,
      'paragraph:A.',
      'paragraph:B.',
      'paragraph:C.',
    ]);
    act(instance, targetOf(instance, 'A.'), 'moveUp');
    expect(instance.state.doc.eq(before)).toBe(true);
  });
});

describe('Delete', () => {
  it('deletes a paragraph, a heading and a list item, the caret staying in the note', () => {
    const instance = noteOf(
      heading('Ferns'),
      paragraph('Body.'),
      bullets('One.', 'Two.'),
      paragraph('End.'),
    );
    act(instance, targetOf(instance, 'Body.'), 'delete');
    act(instance, targetOf(instance, 'Ferns'), 'delete');
    act(instance, targetOf(instance, 'One.'), 'delete');
    expect(blocks(instance)).toEqual(['paragraph:Two.', 'paragraph:End.']);
    expect(instance.state.selection.$head.parent.isTextblock).toBe(true);
  });

  it("takes a list with its only item, and leaves the note's last block an empty paragraph", () => {
    const instance = noteOf(bullets('Only.'), paragraph('Last.'));
    act(instance, targetOf(instance, 'Only.'), 'delete');
    expect(instance.state.doc.child(0).type.name).toBe('paragraph');
    act(instance, targetOf(instance, 'Last.'), 'delete');
    expect(blocks(instance)).toEqual(['paragraph:']);
  });

  it('deletes a raw block as an edit', () => {
    const instance = noteOf(paragraph('A.'), raw('<div>x</div>'));
    act(instance, rawTarget(instance, '<div>x</div>'), 'delete');
    expect(blocks(instance)).toEqual(['paragraph:A.']);
  });
});

describe('one undo reverts one action', () => {
  const cases: readonly { action: BlockAction; on: string }[] = [
    { action: 'addAbove', on: 'Two.' },
    { action: 'addBelow', on: 'One.' },
    { action: 'duplicate', on: 'Kept.' },
    { action: 'moveUp', on: 'Three.' },
    { action: 'moveDown', on: 'One.' },
    { action: 'delete', on: 'Kept.' },
  ];
  for (const { action, on } of cases) {
    it(`${action} undoes to exactly the note before`, () => {
      const instance = noteOf(
        paragraph('One.'),
        raw(RAW),
        bullets('Two.', 'Three.'),
        paragraph('Kept.'),
      );
      // Typing just before: the action is a step of its own, not run together with it.
      instance.commands.insertContentAt(1, 'Typed ');
      const before = instance.state.doc;
      expect(act(instance, targetOf(instance, on === 'One.' ? 'Typed One.' : on), action)).toBe(
        true,
      );
      expect(instance.state.doc.eq(before)).toBe(false);
      instance.commands.undo();
      expect(instance.state.doc.eq(before)).toBe(true);
    });
  }

  it('two moves in a row are two undos', () => {
    const instance = noteOf(paragraph('A.'), paragraph('B.'), paragraph('C.'));
    act(instance, targetOf(instance, 'C.'), 'moveUp');
    act(instance, targetOf(instance, 'C.'), 'moveUp');
    instance.commands.undo();
    expect(blocks(instance)).toEqual(['paragraph:A.', 'paragraph:C.', 'paragraph:B.']);
  });

  it('typing after an action is an undo step of its own', () => {
    const instance = noteOf(paragraph('A.'), paragraph('B.'));
    runBlockAction(instance.view, { target: targetOf(instance, 'A.'), action: 'addBelow' });
    instance.commands.insertContent('Typed.');
    instance.commands.undo();
    expect(blocks(instance)).toEqual(['paragraph:A.', 'paragraph:', 'paragraph:B.']);
  });
});

describe('running an action from the handle or a key', () => {
  it('offers no Move up at the top and no Move down at the bottom', () => {
    const instance = noteOf(paragraph('Top.'), paragraph('Bottom.'));
    expect([...availableBlockActions(instance.view, targetOf(instance, 'Top.'))]).toEqual([
      'addAbove',
      'addBelow',
      'duplicate',
      'moveDown',
      'delete',
    ]);
    expect(
      availableBlockActions(instance.view, targetOf(instance, 'Bottom.')).has('moveDown'),
    ).toBe(false);
  });

  it('does nothing to a block that is not there any more', () => {
    const instance = noteOf(paragraph('A.'), paragraph('B.'));
    const target = targetOf(instance, 'B.');
    instance.commands.insertContentAt(1, 'Typed ');
    expect(runBlockAction(instance.view, { target, action: 'delete' })).toBe(false);
    expect(blocks(instance)).toEqual(['paragraph:Typed A.', 'paragraph:B.']);
  });

  /** A key as the person presses it: Mod is ⌘ on a Mac and Ctrl elsewhere, as the keymaps read it. */
  const press = (
    instance: Editor,
    key: string,
    { mod = false, shift = false, alt = false }: { mod?: boolean; shift?: boolean; alt?: boolean },
  ) => {
    const mac = /Mac/.test(navigator.platform);
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      metaKey: mod && mac,
      ctrlKey: mod && !mac,
      shiftKey: shift,
      altKey: alt,
    });
    instance.view.someProp('handleKeyDown', (handle) => handle(instance.view, event));
  };

  it('answers the keys on the block the caret is in', () => {
    const instance = noteOf(paragraph('A.'), paragraph('B.'));
    instance.commands.setTextSelection(targetOf(instance, 'B.').pos + 1);
    press(instance, 'ArrowUp', { mod: true, shift: true });
    expect(blocks(instance)).toEqual(['paragraph:B.', 'paragraph:A.']);
    press(instance, 'ArrowDown', { mod: true, shift: true });
    expect(blocks(instance)).toEqual(['paragraph:A.', 'paragraph:B.']);
    press(instance, 'd', { mod: true });
    expect(blocks(instance)).toEqual(['paragraph:A.', 'paragraph:B.', 'paragraph:B.']);
    press(instance, 'Backspace', { mod: true, shift: true });
    expect(blocks(instance)).toEqual(['paragraph:A.', 'paragraph:B.']);
    press(instance, 'Enter', { alt: true });
    instance.commands.insertContent('Below.');
    press(instance, 'Enter', { alt: true, shift: true });
    instance.commands.insertContent('Above.');
    expect(blocks(instance)).toEqual([
      'paragraph:A.',
      'paragraph:B.',
      'paragraph:Above.',
      'paragraph:Below.',
    ]);
  });
});

describe('the keys where the block cannot move', () => {
  /** A key with modifiers as the person presses it: Mod is ⌘ on a Mac, Ctrl elsewhere. */
  function pressWith(instance: Editor, key: string, { shift = false } = {}): boolean {
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      metaKey: mac,
      ctrlKey: !mac,
      shiftKey: shift,
    });
    return (
      instance.view.someProp('handleKeyDown', (handle) => handle(instance.view, event)) ?? false
    );
  }

  it('⇧⌘↓ on the last block is not answered, so the platform selects to the end', () => {
    const instance = noteOf(paragraph('First.'), paragraph('Last.'));
    instance.commands.setTextSelection(targetOf(instance, 'Last.').pos + 2);
    const before = instance.state.doc;
    expect(pressWith(instance, 'ArrowDown', { shift: true })).toBe(false);
    expect(instance.state.doc.eq(before)).toBe(true);
  });

  it('⇧⌘↓ on a block that can move is answered, and moves it', () => {
    const instance = noteOf(paragraph('First.'), paragraph('Last.'));
    instance.commands.setTextSelection(targetOf(instance, 'First.').pos + 2);
    expect(pressWith(instance, 'ArrowDown', { shift: true })).toBe(true);
    expect(blocks(instance)).toEqual(['paragraph:Last.', 'paragraph:First.']);
  });

  it('Backspace on a selected raw block is left to the editor, which deletes it', () => {
    const instance = noteOf(paragraph('A.'), raw(RAW), paragraph('B.'));
    const at = rawTarget(instance, RAW).pos;
    instance.view.dispatch(
      instance.state.tr.setSelection(NodeSelection.create(instance.state.doc, at)),
    );
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    instance.view.someProp('handleKeyDown', (handle) => handle(instance.view, event));
    expect(blocks(instance)).toEqual(['paragraph:A.', 'paragraph:B.']);
  });
});
