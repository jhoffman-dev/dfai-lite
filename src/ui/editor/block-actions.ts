import { closeHistory } from '@tiptap/pm/history';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  NodeSelection,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';

/*
 * What a block's handle does to the note, as DFAI's does (its #569): add a
 * block above or below it, duplicate it, move it up or down, delete it. Each
 * is one transaction — one step to undo, never run together with the typing
 * before it.
 *
 * A move is the same block: the node itself, its source identity (`blockId`)
 * with it, so the writer saves it from its own bytes at its new place. A
 * duplicate is the same node again, so an untouched copy is written from
 * those bytes too.
 */

/** A block a handle acts on: where it starts, and the block. */
export interface BlockTarget {
  readonly pos: number;
  readonly node: ProseMirrorNode;
}

/** The actions on a block's menu, in its order. */
export const BLOCK_ACTIONS = [
  'addAbove',
  'addBelow',
  'duplicate',
  'moveUp',
  'moveDown',
  'delete',
] as const;

export type BlockAction = (typeof BLOCK_ACTIONS)[number];

/** The blocks of a list that each have a handle of their own, as Notion's items do. */
const ITEM_TYPES = new Set(['listItem', 'taskItem']);

/** Whether `node` is an item of a list: a bullet, a numbered item, a task. */
export const isListItem = (node: ProseMirrorNode): boolean => ITEM_TYPES.has(node.type.name);

/**
 * The block a handle at a point of the note acts on: the innermost list
 * item the point is in, else the block of the note it is in. `pos` and
 * `inside` are what `posAtCoords` answers; for a selection, its head and the
 * selected node's start. Null where there is none.
 */
export function blockTargetAt(
  doc: ProseMirrorNode,
  { pos, inside }: { pos: number; inside: number },
): BlockTarget | null {
  const node = inside >= 0 ? doc.nodeAt(inside) : null;
  const at = node === null ? pos : node.isLeaf ? inside : inside + 1;
  const $pos = doc.resolve(Math.max(0, Math.min(at, doc.content.size)));
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    if (isListItem($pos.node(depth))) return { pos: $pos.before(depth), node: $pos.node(depth) };
  }
  if ($pos.depth >= 1) return { pos: $pos.before(1), node: $pos.node(1) };
  return $pos.nodeAfter === null ? null : { pos: $pos.pos, node: $pos.nodeAfter };
}

/** The block the selection is in, or the block it selects whole. */
export function blockTargetOfSelection(state: EditorState): BlockTarget | null {
  const { selection, doc } = state;
  if (selection instanceof NodeSelection && selection.node.isBlock) {
    return blockTargetAt(doc, { pos: selection.from, inside: selection.from });
  }
  return blockTargetAt(doc, { pos: selection.head, inside: -1 });
}

/** The edit `action` on `target` makes, or null where it does nothing (the first block moved up). */
export function blockChange(
  state: EditorState,
  { target, action }: { target: BlockTarget; action: BlockAction },
): Transaction | null {
  switch (action) {
    case 'addAbove':
      return insertBlock(state, target, 'above');
    case 'addBelow':
      return insertBlock(state, target, 'below');
    case 'duplicate':
      return duplicateBlock(state, target);
    case 'moveUp':
      return moveBlock(state, target, -1);
    case 'moveDown':
      return moveBlock(state, target, 1);
    case 'delete':
      return deleteBlock(state, target);
  }
}

/** Whether `target` is still the block at its place in `doc`: the note may have changed since. */
export function stillThere(doc: ProseMirrorNode, target: BlockTarget): boolean {
  return target.pos <= doc.content.size && doc.nodeAt(target.pos) === target.node;
}

/**
 * A transaction that is a step of its own to undo — closed off from the typing
 * before it here, and from the typing after it by the handle (`runBlockAction`
 * closes the step again once it is dispatched) — and scrolls to what it changed.
 */
const ownStep = (tr: Transaction): Transaction => closeHistory(tr).scrollIntoView();

/**
 * An empty block above or below `target`, with the caret in it: a paragraph
 * beside a block of the note, an empty item beside a list item.
 */
export function insertBlock(
  state: EditorState,
  target: BlockTarget,
  side: 'above' | 'below',
): Transaction | null {
  const empty = isListItem(target.node)
    ? target.node.type.createAndFill()
    : (state.schema.nodes['paragraph']?.create() ?? null);
  if (empty === null) return null;
  const at = side === 'above' ? target.pos : target.pos + target.node.nodeSize;
  const tr = state.tr.insert(at, empty);
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  return ownStep(tr);
}

/**
 * A copy of `target` after it, the caret at its start (or the copy selected
 * whole, an atom). As DFAI cleans a duplicate, no `^id` the block holds is
 * given to the copy, so the note never has two blocks of one id; a footnote
 * definition is not copied at all (null), as two of one label are one.
 */
export function duplicateBlock(state: EditorState, target: BlockTarget): Transaction | null {
  const copy = withoutBlockIds(target.node);
  if (copy === null) return null;
  const at = target.pos + target.node.nodeSize;
  const tr = state.tr.insert(at, copy);
  tr.setSelection(selectionInBlockAt(tr.doc, at));
  return ownStep(tr);
}

/** A `^id` at the end of a block's last line, as Obsidian writes one, with the space before it. */
const TRAILING_ID = /[ \t]+\^[A-Za-z0-9-]+$/;
/** The same on a line of its own after a block the editor keeps as markdown. */
const ID_LINE = /\n[ \t]*\^[A-Za-z0-9-]+[ \t]*$/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]]+\]:/;

/** `node` with every `^id` it holds taken off; null for a footnote definition. */
function withoutBlockIds(node: ProseMirrorNode): ProseMirrorNode | null {
  if (node.type.name === 'rawBlock') {
    const markdown = String(node.attrs['markdown'] ?? '');
    if (FOOTNOTE_DEFINITION.test(markdown)) return null;
    const bare = markdown.replace(ID_LINE, '').replace(TRAILING_ID, '');
    return bare === markdown ? node : node.type.create({ ...node.attrs, markdown: bare });
  }
  if (node.isTextblock) return withoutTrailingId(node);
  const children: ProseMirrorNode[] = [];
  let changed = false;
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    const kept = withoutBlockIds(child) ?? child;
    changed ||= kept !== child;
    children.push(kept);
  }
  return changed ? node.copy(Fragment.from(children)) : node;
}

/** A line of text with the `^id` at its end, if it has one, taken off. */
function withoutTrailingId(block: ProseMirrorNode): ProseMirrorNode {
  const last = block.lastChild;
  if (last === null || !last.isText || !TRAILING_ID.test(last.text ?? '')) return block;
  const text = (last.text ?? '').replace(TRAILING_ID, '');
  const children: ProseMirrorNode[] = [];
  block.forEach((child, _offset, index) => {
    if (index < block.childCount - 1) children.push(child);
  });
  if (text !== '') children.push(block.type.schema.text(text, last.marks));
  return block.copy(Fragment.from(children));
}

/**
 * `target` moved past the next block above it (`-1`) or below it (`1`) in
 * the same list or note; null at the end of what it is in. The selection
 * moves with it, so a move up and then down gives the note back as it was.
 */
export function moveBlock(
  state: EditorState,
  target: BlockTarget,
  direction: -1 | 1,
): Transaction | null {
  const $target = state.doc.resolve(target.pos);
  const passed = $target.index() + direction;
  if ($target.parent.maybeChild(passed) === null) return null;
  const size = target.node.nodeSize;
  // Up: before the block passed. Down: after it, once the block is out.
  const at =
    direction < 0 ? $target.posAtIndex(passed) : $target.posAtIndex(passed + direction) - size;
  const tr = state.tr.delete(target.pos, target.pos + size).insert(at, target.node);
  tr.setSelection(movedSelection(state.selection, target, at, tr.doc));
  return ownStep(tr);
}

/**
 * `target` deleted. A list item that is its list's only one takes the list
 * with it; the note's last block leaves an empty paragraph with the caret in
 * it, as a note always holds somewhere to type.
 */
export function deleteBlock(state: EditorState, target: BlockTarget): Transaction {
  let { pos, node } = target;
  let $pos = state.doc.resolve(pos);
  while ($pos.depth > 0 && $pos.parent.childCount === 1) {
    pos = $pos.before();
    node = $pos.parent;
    $pos = state.doc.resolve(pos);
  }
  const tr = state.tr;
  const paragraph = state.schema.nodes['paragraph'];
  if ($pos.depth === 0 && state.doc.childCount === 1 && paragraph !== undefined) {
    tr.replaceWith(pos, pos + node.nodeSize, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    return ownStep(tr);
  }
  tr.delete(pos, pos + node.nodeSize);
  const $at = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
  tr.setSelection(
    Selection.findFrom($at, 1, true) ?? Selection.findFrom($at, -1, true) ?? Selection.near($at),
  );
  return ownStep(tr);
}

/** The caret at the start of the block at `at`, or the block selected whole when it has no text. */
function selectionInBlockAt(doc: ProseMirrorNode, at: number): Selection {
  const block = doc.nodeAt(at);
  if (block !== null && block.isAtom && NodeSelection.isSelectable(block)) {
    return NodeSelection.create(doc, at);
  }
  return Selection.findFrom(doc.resolve(at), 1, true) ?? Selection.near(doc.resolve(at));
}

/** The selection as it was within `target`, now at `at`; elsewhere, left where it maps to. */
function movedSelection(
  selection: Selection,
  target: BlockTarget,
  at: number,
  doc: ProseMirrorNode,
): Selection {
  const shift = at - target.pos;
  if (selection instanceof NodeSelection && selection.from === target.pos) {
    return NodeSelection.create(doc, at);
  }
  const end = target.pos + target.node.nodeSize;
  if (selection.from > target.pos && selection.to < end) {
    return TextSelection.create(doc, selection.anchor + shift, selection.head + shift);
  }
  return selectionInBlockAt(doc, at);
}
