import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from 'react';
import { dropFolderAt } from '../../application/index.ts';
import type { DropPoint, FolderNode, VaultEntry, VaultPath } from '../../domain/vault/index.ts';
import { useApp } from '../services.ts';
import { edgeScrollStep } from './edge-scroll.ts';
import { hoverOpener } from './hover-opener.ts';
import { ROW_HEIGHT } from './tree-row.tsx';

/** A dragged tree row, as a drop target reads it. */
export const ENTRY_DRAG = 'application/x-dfai-lite-entry';

/** The tile sits just below and right of the pointer, clear of the row it points at. */
const TILE_OFFSET = { x: 12, y: 8 };

/**
 * A blank picture for the browser's own drag image, so only the tile shows.
 * Made when the module loads: WebKit draws the default ghost for an image
 * that has not loaded yet, and a data URL has loaded long before a drag.
 */
const BLANK_DRAG_IMAGE = new Image(1, 1);
BLANK_DRAG_IMAGE.src =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The slot under the pointer, by its `data-entry-*`; null for the space around the rows. */
function pointAt(element: EventTarget | null): DropPoint {
  const slot =
    element instanceof Element ? element.closest<HTMLElement>('[data-entry-path]') : null;
  if (slot === null) return null;
  const path = slot.dataset['entryPath'] ?? '';
  // A new folder's name field stands for the folder it is in, as a note does.
  return { kind: slot.dataset['entryKind'] === 'note' ? 'note' : 'folder', path };
}

/** Whether a drag's pointer is inside `element`'s box: WebKit can leave `relatedTarget` empty. */
function pointerInside(element: Element, at: { clientX: number; clientY: number }): boolean {
  const box = element.getBoundingClientRect();
  return (
    at.clientX > box.left &&
    at.clientX < box.right &&
    at.clientY > box.top &&
    at.clientY < box.bottom
  );
}

interface TreeDragArgs {
  readonly tree: FolderNode;
  readonly scroller: RefObject<HTMLElement | null>;
  readonly expand: (folder: VaultPath) => void;
  readonly isOpen: (folder: VaultPath) => boolean;
}

/**
 * Dragging rows of the tree onto folders, or onto the top of the vault ('').
 * One rule keeps the drop where the highlight is: only a `dragover` aims, at
 * the slot under the pointer (`dropFolderAt` says which folder that means,
 * or none), and the drop moves into the folder aimed at then — it never
 * works the folder out again from where the drop event lands. What is
 * dragged is held here, as a drag's data cannot be read until the drop. A
 * closed folder held over for `OPEN_AFTER_MS` opens; the tree scrolls near
 * its edges.
 */
export function useTreeDrag({ tree, scroller, expand, isOpen }: TreeDragArgs) {
  const { actions } = useApp();
  const latest = useRef({ tree, isOpen });
  useLayoutEffect(() => {
    latest.current = { tree, isOpen };
  });
  const heldRef = useRef<VaultEntry | null>(null);
  const [held, setHeld] = useState<VaultEntry | null>(null);
  const targetRef = useRef<VaultPath | null>(null);
  const [target, setTarget] = useState<VaultPath | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  /** The row under the pointer, kept under it if rows change around it. */
  const hovered = useRef<DropPoint>(null);
  const tile = useRef<HTMLDivElement>(null);
  const scrolling = useRef<number | null>(null);
  const opener = useMemo(() => hoverOpener(expand), [expand]);

  const aim = useCallback((folder: VaultPath | null) => {
    targetRef.current = folder;
    setTarget(folder);
  }, []);

  const stopScrolling = useCallback(() => {
    if (scrolling.current !== null) cancelAnimationFrame(scrolling.current);
    scrolling.current = null;
  }, []);

  /** Aims at nothing: the drag is off the tree. */
  const aimAway = useCallback(() => {
    hovered.current = null;
    aim(null);
    opener.hover(null);
    stopScrolling();
  }, [aim, opener, stopScrolling]);

  /** Aims at the slot under `element`; a closed folder that would take the drop starts its wait. */
  const aimAt = useCallback(
    (element: EventTarget | null, entry: VaultEntry) => {
      const point = pointAt(element);
      hovered.current = point;
      const folder = dropFolderAt(entry, point, latest.current.tree);
      aim(folder);
      const opens = point?.kind === 'folder' && folder === point.path;
      opener.hover(opens && !latest.current.isOpen(point.path) ? point.path : null);
    },
    [aim, opener],
  );

  const end = useCallback(() => {
    aimAway();
    heldRef.current = null;
    setHeld(null);
    opener.cancel();
  }, [aimAway, opener]);

  /** Scrolls while the pointer rests near an edge, aiming again at whatever row comes under it. */
  const scrollNearEdge = useCallback(() => {
    const stepNow = () => {
      const box = scroller.current?.getBoundingClientRect();
      return box === undefined ? 0 : edgeScrollStep(pointer.current, box);
    };
    if (stepNow() === 0) return stopScrolling();
    if (scrolling.current !== null) return;
    const frame = () => {
      const element = scroller.current;
      const entry = heldRef.current;
      const step = stepNow();
      if (element === null || entry === null || step === 0) return stopScrolling();
      element.scrollTop += step;
      aimAt(document.elementFromPoint(pointer.current.x, pointer.current.y), entry);
      scrolling.current = requestAnimationFrame(frame);
    };
    scrolling.current = requestAnimationFrame(frame);
  }, [aimAt, scroller, stopScrolling]);

  const placeTile = useCallback(() => {
    const { x, y } = pointer.current;
    const at = `translate(${x + TILE_OFFSET.x}px, ${y + TILE_OFFSET.y}px)`;
    tile.current?.style.setProperty('transform', at);
  }, []);
  useLayoutEffect(placeTile, [held, placeTile]);

  // The tile follows the pointer anywhere in the window. A drag that ends,
  // or drops anywhere, is over; one that leaves the window aims at nothing.
  useEffect(() => {
    const follow = (event: globalThis.DragEvent) => {
      if (heldRef.current === null || event.dataTransfer?.types.includes(ENTRY_DRAG) !== true) {
        return;
      }
      pointer.current = { x: event.clientX, y: event.clientY };
      tile.current?.removeAttribute('data-away');
      placeTile();
    };
    const leftWindow = (event: globalThis.DragEvent) => {
      if (heldRef.current === null || event.relatedTarget !== null) return;
      if (pointerInside(document.documentElement, event)) return;
      tile.current?.setAttribute('data-away', '');
      aimAway();
    };
    window.addEventListener('dragover', follow, true);
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    window.addEventListener('dragleave', leftWindow);
    return () => {
      window.removeEventListener('dragover', follow, true);
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
      window.removeEventListener('dragleave', leftWindow);
      end();
    };
  }, [aimAway, end, placeTile]);

  /** The row being dragged, only while this drag is one: a tab or a Finder file carries none. */
  const heldBy = (event: DragEvent): VaultEntry | null =>
    event.dataTransfer.types.includes(ENTRY_DRAG) ? heldRef.current : null;

  const start = useCallback((entry: VaultEntry, event: DragEvent) => {
    // A link's own drag carries its URL, which the editor would paste as text.
    event.dataTransfer.clearData();
    event.dataTransfer.setData(ENTRY_DRAG, entry.path);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(BLANK_DRAG_IMAGE, 0, 0);
    pointer.current = { x: event.clientX, y: event.clientY };
    heldRef.current = entry;
    setHeld(entry);
  }, []);

  /** The tree's own handlers: the whole Notes section is one drop zone, rows and space alike. */
  const zone = {
    onDragOver(event: DragEvent) {
      const entry = heldBy(event);
      if (entry === null) return;
      pointer.current = { x: event.clientX, y: event.clientY };
      aimAt(event.target, entry);
      scrollNearEdge();
      if (targetRef.current === null) {
        event.dataTransfer.dropEffect = 'none';
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    onDragLeave(event: DragEvent) {
      if (heldBy(event) === null) return;
      const into = event.relatedTarget;
      const stays =
        into instanceof Node
          ? event.currentTarget.contains(into)
          : pointerInside(event.currentTarget, event);
      if (!stays) aimAway();
    },
    onDrop(event: DragEvent) {
      const entry = heldBy(event);
      if (entry === null) return;
      event.preventDefault();
      const folder = targetRef.current;
      end();
      if (folder === null || event.dataTransfer.getData(ENTRY_DRAG) !== entry.path) return;
      actions.moveInto(entry, folder).catch(actions.report);
    },
  };

  /**
   * Keeps the row under the pointer under it when rows change above it
   * mid-drag (a note another program made, say), by scrolling as far.
   */
  const keepHoveredRow = useCallback(
    (before: readonly { path: VaultPath }[], after: readonly { path: VaultPath }[]) => {
      const row = hovered.current;
      const element = scroller.current;
      if (row === null || heldRef.current === null || element === null) return;
      const was = before.findIndex((other) => other.path === row.path);
      const now = after.findIndex((other) => other.path === row.path);
      if (was === -1 || now === -1 || was === now) return;
      element.scrollBy({ top: (now - was) * ROW_HEIGHT });
    },
    [scroller],
  );

  return { start, zone, target, held, tile, keepHoveredRow };
}
