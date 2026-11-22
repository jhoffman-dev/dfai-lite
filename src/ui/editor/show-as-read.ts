import type { Editor } from '@tiptap/core';
import { Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorDocument } from '../../domain/markdown/index.ts';
import { forgetPageSelection } from './page-selection.ts';
import { selectionAfterReread } from './reread-selection.ts';
import { needsTrailingLine } from './trailing-line.ts';

/** The meta a document read from its file is shown with: not typed here, so neither saved nor sent on. */
export const READ_FROM_FILE = 'lite:readFromFile';

/** Each block's source identity: refreshed on a re-read, never a reason to redraw the block. */
const BLOCK_ID = 'blockId';

/**
 * Shows `doc`, the note read again from its file (or typed in another
 * view of it), in place of what the editor holds.
 *
 * Only the run of top-level blocks that differ is replaced, so every other
 * block keeps its DOM and the page does not jump; each kept block takes the
 * new reading's id, so the next save writes it from the bytes it now has.
 * Not a step to undo: the file changed, the person did not type it. The
 * caret stays on its line, at its offset in it.
 */
export function showAsRead(editor: Editor, doc: EditorDocument): void {
  const { state } = editor;
  const before = state.doc;
  const after = withTrailingLine(state.schema.nodeFromJSON(doc));
  const tr = state.tr;
  const run = differingRun(before, after);
  if (run !== null) {
    tr.replaceWith(run.from, run.to, after.slice(run.fromAfter, run.toAfter).content);
  }
  takeBlockIds(tr.doc, after, (pos, id) => tr.setNodeAttribute(pos, BLOCK_ID, id));
  if (!tr.docChanged) return;
  tr.setSelection(selectionAfterReread(state.selection, { before, after: tr.doc }));
  editor.view.dispatch(tr.setMeta(READ_FROM_FILE, true).setMeta('addToHistory', false));
  // Without focus, ProseMirror leaves the page's caret alone and keeps its
  // record of where it last saw it; a click back on that spot would then not
  // be read, and the editor would act on its own selection instead.
  if (!editor.view.hasFocus()) forgetPageSelection(editor.view);
}

/** The note as the editor holds it: an empty line at its end to type in, where it needs one. */
function withTrailingLine(doc: ProseMirrorNode): ProseMirrorNode {
  const paragraph = doc.type.schema.nodes['paragraph'];
  if (paragraph === undefined || !needsTrailingLine(doc)) return doc;
  return doc.copy(doc.content.addToEnd(paragraph.create()));
}

/**
 * The top-level blocks between the longest run the two notes start with
 * and the longest they end with, as positions in each; null when they hold
 * the same blocks.
 */
function differingRun(
  before: ProseMirrorNode,
  after: ProseMirrorNode,
): { from: number; to: number; fromAfter: number; toAfter: number } | null {
  const shorter = Math.min(before.childCount, after.childCount);
  let start = 0;
  let from = 0;
  while (start < shorter && sameBlock(before.child(start), after.child(start))) {
    from += before.child(start).nodeSize;
    start += 1;
  }
  if (start === before.childCount && start === after.childCount) return null;
  let end = 0;
  let to = before.content.size;
  let toAfter = after.content.size;
  while (
    end < shorter - start &&
    sameBlock(before.child(before.childCount - 1 - end), after.child(after.childCount - 1 - end))
  ) {
    to -= before.child(before.childCount - 1 - end).nodeSize;
    toAfter -= after.child(after.childCount - 1 - end).nodeSize;
    end += 1;
  }
  return { from, to, fromAfter: from, toAfter };
}

/** Whether two blocks read the same, whatever source each was read from. */
function sameBlock(one: ProseMirrorNode, other: ProseMirrorNode): boolean {
  if (one.type !== other.type || !Mark.sameSet(one.marks, other.marks)) return false;
  const keys = new Set([...Object.keys(one.attrs), ...Object.keys(other.attrs)]);
  for (const key of keys) if (key !== BLOCK_ID && one.attrs[key] !== other.attrs[key]) return false;
  return one.content.eq(other.content);
}

/** Calls `set` for each top-level block of `doc` whose id is not the one `after` gives it. */
function takeBlockIds(
  doc: ProseMirrorNode,
  after: ProseMirrorNode,
  set: (pos: number, id: unknown) => void,
): void {
  if (doc.childCount !== after.childCount) return;
  doc.forEach((block, pos, index) => {
    const id = after.child(index).attrs[BLOCK_ID];
    if (BLOCK_ID in block.attrs && block.attrs[BLOCK_ID] !== id) set(pos, id);
  });
}
