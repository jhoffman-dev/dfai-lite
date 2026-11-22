/**
 * The web view's own right-click menu, kept to where it helps. On the app's
 * chrome it offers Reload (which throws away the open tabs) and Back, so it
 * is turned off there; on text — the editor, a field, the read view, or a
 * selection — it stays, for spelling, Copy and Paste.
 */
const TEXT_PLACES = 'input, textarea, [contenteditable="true"], .read-view';

export function keepPageMenuToText(doc: Document): void {
  doc.addEventListener('contextmenu', (event) => {
    if (onText(event.target) || hasSelection(doc)) return;
    event.preventDefault();
  });
}

function onText(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_PLACES) !== null;
}

function hasSelection(doc: Document): boolean {
  const selection = doc.getSelection();
  return selection !== null && !selection.isCollapsed;
}
