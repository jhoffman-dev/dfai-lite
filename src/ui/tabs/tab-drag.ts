/** A dragged tab, as a drop target reads it. */
const TAB_DRAG = 'application/x-dfai-lite-tab';
/**
 * The pane the tab comes from, carried in a type name: while a drag is over a
 * target only the types can be read, not the data, and a pane's content must
 * know then whether the drop would do anything.
 */
const FROM_PANE = 'application/x-dfai-lite-tab-from-';

type Transfer = Pick<DataTransfer, 'setData' | 'getData' | 'types'> & {
  effectAllowed: DataTransfer['effectAllowed'];
};

export function startTabDrag(
  transfer: Transfer,
  { tabId, paneIndex }: { tabId: string; paneIndex: number },
): void {
  transfer.setData(TAB_DRAG, tabId);
  transfer.setData(`${FROM_PANE}${paneIndex}`, '');
  transfer.effectAllowed = 'move';
}

export function isTabDrag(transfer: Pick<DataTransfer, 'types'>): boolean {
  return transfer.types.includes(TAB_DRAG);
}

/** The pane a dragged tab comes from, readable while the drag is still moving. */
export function dragSourcePane(transfer: Pick<DataTransfer, 'types'>): number | null {
  const type = transfer.types.find((candidate) => candidate.startsWith(FROM_PANE));
  return type === undefined ? null : Number(type.slice(FROM_PANE.length));
}

/** The dragged tab's id, on drop; empty if what was dropped is not a tab. */
export function draggedTabId(transfer: Pick<DataTransfer, 'getData'>): string {
  return transfer.getData(TAB_DRAG);
}
