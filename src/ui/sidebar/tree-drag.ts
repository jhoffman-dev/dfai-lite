import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import { pathMovedInto } from '../../application/index.ts';
import type { VaultEntry, VaultPath } from '../../domain/vault/index.ts';
import { useApp } from '../services.ts';
import type { RowDrag } from './tree-row.tsx';

/** A dragged tree row, as a drop target reads it. */
export const ENTRY_DRAG = 'application/x-dfai-lite-entry';
/** How long a drag rests on a closed folder before it opens. */
const OPEN_AFTER_MS = 600;

/**
 * Dragging rows of the tree onto folders (or the top of the vault, '').
 * What is dragged is held here, since a drag's data cannot be read until
 * the drop; `target` is the folder a drop would land in, for the highlight.
 * The rule (what may go where) is `pathMovedInto`; a closed folder held
 * over opens, through `expand`.
 */
export function useTreeDrag({
  expand,
  isOpen,
}: {
  expand: (folder: VaultPath) => void;
  isOpen: (folder: VaultPath) => boolean;
}): { readonly rowDrag: RowDrag; readonly target: VaultPath | null } {
  const { actions } = useApp();
  const dragged = useRef<VaultEntry | null>(null);
  const [target, setTarget] = useState<VaultPath | null>(null);
  const opening = useRef<{ folder: VaultPath; timer: ReturnType<typeof setTimeout> } | null>(null);
  const openNow = useRef(isOpen);
  useLayoutEffect(() => {
    openNow.current = isOpen;
  });

  const stopOpening = useCallback(() => {
    if (opening.current !== null) clearTimeout(opening.current.timer);
    opening.current = null;
  }, []);

  const end = useCallback(() => {
    dragged.current = null;
    stopOpening();
    setTarget(null);
  }, [stopOpening]);

  // A row scrolled out of the virtual list takes its own dragend with it: hear it on the window,
  // with any drop anywhere and a drag leaving the window, so a cancelled drag is never left held.
  useEffect(() => {
    const leftWindow = (event: globalThis.DragEvent) => event.relatedTarget === null && end();
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    window.addEventListener('dragleave', leftWindow);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
      window.removeEventListener('dragleave', leftWindow);
      end();
    };
  }, [end]);

  /** The row being dragged, only while this drag is one: a tab or a Finder file carries none. */
  const heldBy = (event: DragEvent): VaultEntry | null =>
    event.dataTransfer.types.includes(ENTRY_DRAG) ? dragged.current : null;

  const handlers = useMemo<RowDrag>(() => {
    const openLater = (folder: VaultPath) => {
      if (folder === '' || openNow.current(folder) || opening.current?.folder === folder) return;
      stopOpening();
      opening.current = { folder, timer: setTimeout(() => expand(folder), OPEN_AFTER_MS) };
    };
    return {
      start(entry, event) {
        // A link's own drag carries its URL, which the editor would paste as text.
        event.dataTransfer.clearData();
        event.dataTransfer.setData(ENTRY_DRAG, entry.path);
        event.dataTransfer.effectAllowed = 'move';
        dragged.current = entry;
      },
      over(folder, event: DragEvent) {
        const entry = heldBy(event);
        if (entry === null) return;
        event.stopPropagation();
        const allowed = pathMovedInto(entry, folder) !== null;
        setTarget(allowed ? folder : null);
        if (event.currentTarget.getAttribute('data-kind') === 'folder') openLater(folder);
        else stopOpening();
        if (!allowed) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      },
      drop(folder, event) {
        const entry = heldBy(event);
        end();
        if (entry !== null && event.dataTransfer.getData(ENTRY_DRAG) !== entry.path) return;
        if (entry === null || pathMovedInto(entry, folder) === null) return;
        event.preventDefault();
        event.stopPropagation();
        actions.moveInto(entry, folder).catch(actions.report);
      },
      leave(event) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null);
      },
    };
  }, [actions, end, expand, stopOpening]);

  return { rowDrag: handlers, target };
}
