import { closeHistory } from '@tiptap/pm/history';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { BlockTarget } from './block-actions.ts';

/*
 * What a block's menu does to callouts, as Notion's "Turn into" does: change
 * a callout's type in place, wrap a block in a callout, or unwrap one to its
 * content. Each is one transaction, one step to undo. Which name is written
 * is the caller's (`kindAfterChange`); here is only the edit.
 */

/** The callout `target` is or is in, nearest first; null when it is in none. */
export function calloutAround(state: EditorState, target: BlockTarget): BlockTarget | null {
  if (target.node.type.name === 'callout') return target;
  const $pos = state.doc.resolve(target.pos);
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === 'callout') return { pos: $pos.before(depth), node };
  }
  return null;
}

const ownStep = (tr: Transaction): Transaction => closeHistory(tr);

/** The callout at `callout` with its type set to `kind`, its title, fold and body as they were. */
export function setCalloutKind(
  state: EditorState,
  { callout, kind }: { callout: BlockTarget; kind: string },
): Transaction | null {
  if (callout.node.attrs['kind'] === kind) return null;
  return ownStep(state.tr.setNodeMarkup(callout.pos, undefined, { ...callout.node.attrs, kind }));
}

/** Whether `target` can be wrapped in a callout: a block of the note's own, not a callout or kept source. */
export function canTurnIntoCallout(state: EditorState, target: BlockTarget): boolean {
  const name = target.node.type.name;
  return (
    state.doc.resolve(target.pos).depth === 0 &&
    name !== 'callout' &&
    name !== 'rawBlock' &&
    state.schema.nodes['callout'] !== undefined
  );
}

/** `target` wrapped in a new callout of `kind`, with no title, the caret where it was. */
export function wrapInCallout(
  state: EditorState,
  { target, kind }: { target: BlockTarget; kind: string },
): Transaction | null {
  const type = state.schema.nodes['callout'];
  if (type === undefined || !canTurnIntoCallout(state, target)) return null;
  const callout = type.createChecked({ kind, title: null, fold: null }, target.node);
  const tr = state.tr.replaceWith(target.pos, target.pos + target.node.nodeSize, callout);
  tr.setSelection(TextSelection.near(tr.doc.resolve(target.pos + 2)));
  return ownStep(tr.scrollIntoView());
}

/**
 * The callout replaced by its body. Its title, which is not part of the
 * body, becomes the body's first paragraph, so no word of it is lost.
 */
export function unwrapCallout(
  state: EditorState,
  { callout }: { callout: BlockTarget },
): Transaction | null {
  const paragraph = state.schema.nodes['paragraph'];
  const title = callout.node.attrs['title'];
  const heading =
    typeof title === 'string' && title !== '' && paragraph !== undefined
      ? [paragraph.create(null, state.schema.text(title))]
      : [];
  const content = Fragment.from(heading).append(callout.node.content);
  const tr = state.tr.replaceWith(callout.pos, callout.pos + callout.node.nodeSize, content);
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(Math.min(callout.pos + 1, tr.doc.content.size))),
  );
  return ownStep(tr.scrollIntoView());
}
