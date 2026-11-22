import type { Editor } from '@tiptap/core';
import { Selection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { caretPlaceFor, type CaretTarget, type PagePoint } from '../note/page-caret.ts';

/**
 * The editor as the page's caret target: a press beside, above or below
 * the text puts the caret where `caretPlaceFor` says, and focuses the text.
 */
export function editorCaretTarget(editor: Editor): CaretTarget {
  return {
    placeAt(point, { extend }) {
      if (editor.isDestroyed) return;
      const { view } = editor;
      const head = positionAt(view, point);
      const { doc, selection } = view.state;
      const anchor = extend ? selection.anchor : head;
      const next = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
      // No scrollIntoView: the caret lands where the person pressed, already in sight.
      view.dispatch(view.state.tr.setSelection(next));
      if (!view.hasFocus()) view.focus();
    },
    typeIn(text) {
      if (editor.isDestroyed) return;
      const chain = editor.chain().focus();
      text.split('\n').forEach((line, index) => {
        if (index > 0) chain.splitBlock();
        if (line !== '') chain.command(({ tr }) => Boolean(tr.insertText(line)));
      });
      chain.run();
    },
  };
}

function positionAt(view: EditorView, point: PagePoint): number {
  const { doc } = view.state;
  const place = caretPlaceFor(point, view.dom.getBoundingClientRect());
  if (place.kind === 'start') return Selection.atStart(doc).from;
  if (place.kind === 'end') return Selection.atEnd(doc).from;
  return view.posAtCoords({ left: place.x, top: place.y })?.pos ?? Selection.atEnd(doc).from;
}
