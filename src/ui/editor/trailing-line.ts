import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { onlyRedraws } from './code-highlight.ts';

/*
 * The note ends where the person can type. After a last block that is not a
 * paragraph — a table, a picture, a heading — an empty paragraph is kept at
 * the end to type in, as Tiptap's TrailingNode keeps one. The paragraph is
 * dropped by the save when it is still empty (markdown-blocks.ts).
 */

/**
 * Whether the note needs an empty paragraph at its end to type in: after any
 * last block but a paragraph, and after a paragraph that ends in a picture.
 * The picture is an inline atom: the caret after it sits beside the picture
 * at its edge, and words typed there run alongside it in the same paragraph.
 * The line under it is where the note goes on below the picture, as it does
 * below a last table or heading.
 */
export const needsTrailingLine = (doc: ProseMirrorNode): boolean => {
  const last = doc.lastChild;
  return last?.type.name !== 'paragraph' || last.lastChild?.type.name === 'image';
};

export const TrailingLine = Extension.create({
  name: 'trailingLine',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('trailingLine'),
        // On every transaction, as TrailingNode was: a note opened on a last atom
        // gets its line on the first, and an undo that brings the atom back gives
        // the note exactly what it had before.
        appendTransaction: (transactions, _before, state) => {
          // A redraw (code colored as its grammar arrives) is no visit to the note.
          if (onlyRedraws(transactions)) return null;
          const paragraph = state.schema.nodes['paragraph'];
          if (paragraph === undefined || !needsTrailingLine(state.doc)) return null;
          const line = state.tr.insert(state.doc.content.size, paragraph.create());
          // A line an edit calls for — a move that leaves a table last, the last
          // paragraph deleted — is undone with that edit, as one step. The line
          // added on opening the note, by a focus or a selection that changed
          // nothing, is no step of its own: the person did not type it, and the
          // first ⌘Z took it only for this to put it straight back.
          const forAnEdit = transactions.some((transaction) => transaction.docChanged);
          return forAnEdit ? line : line.setMeta('addToHistory', false);
        },
      }),
    ];
  },
});
