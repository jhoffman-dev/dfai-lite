import { useState, type DragEvent } from 'react';
import { useApp } from '../services.ts';
import { dragSourcePane, draggedTabId, isTabDrag } from '../tabs/tab-drag.ts';
import { dropOnPane, paneDropFor, type DropSide } from './layout.ts';

export type PaneDropZone = 'pane' | 'split';

function sideOf(event: DragEvent<HTMLElement>): DropSide {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX > box.left + box.width / 2 ? 'right' : 'left';
}

/**
 * A pane's content as a drop target for a dragged tab: the other pane's tab
 * moves in; on a single pane, the right half opens a second pane. `zone` is
 * what the drop would do, for the highlight; the rule is `dropOnPane`.
 */
export function usePaneDrop(index: number, enabled: boolean) {
  const { workspace, layout } = useApp();
  const [zone, setZone] = useState<PaneDropZone | null>(null);

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!enabled || !isTabDrag(event.dataTransfer)) return;
    const fromPane = dragSourcePane(event.dataTransfer);
    const drop =
      fromPane === null
        ? null
        : paneDropFor(layout.getState(), { fromPane, toPane: index, side: sideOf(event) });
    setZone(drop);
    if (drop === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    // Moving between children fires a leave too; only leaving the pane clears the highlight.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setZone(null);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    setZone(null);
    const tabId = draggedTabId(event.dataTransfer);
    if (!enabled || tabId === '') return;
    event.preventDefault();
    const side = sideOf(event);
    workspace.arrange((current) => dropOnPane(current, { tabId, toPane: index, side }));
  };

  return { zone, handlers: { onDragOver, onDragLeave, onDrop } };
}
