import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const EMPTY_NOTE_HINT = 'Start writing…';

/** Whether the note has nothing in it: one empty line, the one a new note opens on. */
function isEmptyNote(doc: ProseMirrorNode): boolean {
  const only = doc.firstChild;
  return doc.childCount === 1 && only !== null && only.isTextblock && only.content.size === 0;
}

/**
 * A quiet "Start writing…" on an empty note's line, drawn by the stylesheet
 * from the line's `data-placeholder`. A decoration, so it is never text in
 * the note, and it goes with the first key typed.
 */
export const EmptyNote = Extension.create({
  name: 'emptyNote',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('emptyNote'),
        props: {
          decorations: ({ doc }) => {
            const only = doc.firstChild;
            if (only === null || !isEmptyNote(doc)) return DecorationSet.empty;
            return DecorationSet.create(doc, [
              Decoration.node(0, only.nodeSize, {
                class: 'editor-empty',
                'data-placeholder': EMPTY_NOTE_HINT,
              }),
            ]);
          },
        },
      }),
    ];
  },
});
