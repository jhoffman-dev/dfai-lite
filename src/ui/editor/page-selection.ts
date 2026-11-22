import type { EditorView } from '@tiptap/pm/view';

/**
 * The view's DOM observer. Not in prosemirror-view's types, but it is how the
 * view itself reads the page's selection (on every `selectionchange`); a
 * version without it throws on the access, which is caught.
 */
interface ObservedView extends EditorView {
  domObserver: {
    /** Where the observer last saw the page's selection; it reads only a change from it. */
    currentSelection: { clear: () => void };
  };
}

/** Makes the observer read the page's next selection, wherever it is. */
export function forgetPageSelection(view: EditorView): void {
  try {
    (view as ObservedView).domObserver.currentSelection.clear();
  } catch {
    // Safe to ignore: without the observer's record, a caret put back on
    // the spot last read is not read, and the editor keeps its own selection.
  }
}
