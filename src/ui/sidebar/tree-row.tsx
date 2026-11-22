import { memo, type DragEvent, type MouseEvent } from 'react';
import type { TreeRow, VaultEntry, VaultPath } from '../../domain/vault/index.ts';
import { Icon } from '../shell/icons.tsx';
import type { MenuTarget } from './menu-items.ts';

export const ROW_HEIGHT = 28;
export const INDENT = 14;
const CHEVRON = 20;

/** The menu for a row, opened at a point. */
export function menuTargetOf(row: TreeRow, at: { x: number; y: number }): MenuTarget {
  return row.kind === 'folder'
    ? { kind: 'folder', path: row.path, ...at }
    : { kind: 'note', path: row.path, ...at, favoriteAt: null };
}

interface TreeRowProps {
  readonly row: TreeRow;
  readonly index: number;
  readonly active: boolean;
  readonly focusable: boolean;
  /** A drop now would land in this folder: lit. */
  readonly dropTarget: boolean;
  /** This row is the one being dragged: faded in place. */
  readonly dragged: boolean;
  readonly onDragStart: (entry: VaultEntry, event: DragEvent) => void;
  readonly onToggle: (path: VaultPath) => void;
  readonly onMenu: (row: TreeRow, event: MouseEvent) => void;
  readonly onFocusRow: (index: number) => void;
}

/** One folder or note in the tree: a link for a note, a toggle for a folder; both drag. */
export const TreeRowView = memo(function TreeRowView({
  row,
  index,
  active,
  focusable,
  dropTarget,
  dragged,
  onDragStart,
  onToggle,
  onMenu,
  onFocusRow,
}: TreeRowProps) {
  const isFolder = row.kind === 'folder';
  const common = {
    role: 'treeitem',
    'data-index': index,
    'data-kind': row.kind,
    tabIndex: focusable ? 0 : -1,
    'aria-level': row.depth + 1,
    // A note lines up with its folder's name, past the chevron.
    style: { paddingLeft: 8 + row.depth * INDENT + (isFolder ? 0 : CHEVRON) },
    draggable: true,
    onFocus: () => onFocusRow(index),
    onContextMenu: (event: MouseEvent) => onMenu(row, event),
    onDragStart: (event: DragEvent) => onDragStart({ kind: row.kind, path: row.path }, event),
  } as const;
  const faded = dragged ? ' is-dragged' : '';

  if (isFolder) {
    return (
      <div
        {...common}
        className={`tree-row is-folder${dropTarget ? ' is-drop-target' : ''}${faded}`}
        aria-expanded={row.expanded}
        onClick={() => onToggle(row.path)}
      >
        <span className={`tree-chevron${row.expanded ? ' is-open' : ''}`}>
          <Icon name="chevron" />
        </span>
        <span className="sidebar-row-label">{row.name}</span>
        <span className="tree-count">{row.noteCount}</span>
      </div>
    );
  }
  return (
    <a
      {...common}
      className={`tree-row is-note${active ? ' is-active' : ''}${faded}`}
      href={`#/note/${encodeURIComponent(row.path)}`}
      aria-current={active ? 'page' : undefined}
      aria-selected={active}
    >
      <span className="sidebar-row-label">{row.name}</span>
    </a>
  );
});

/** The "…" beside a row, shown on hover and focus: the row's menu, without knowing to right-click. */
export function RowMore({ row, onMenu }: { row: TreeRow; onMenu: (target: MenuTarget) => void }) {
  return (
    <button
      type="button"
      className="tree-row-more"
      tabIndex={-1}
      aria-label={`More for ${row.name}`}
      title="More"
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        onMenu(menuTargetOf(row, { x: box.left, y: box.bottom }));
      }}
    >
      <Icon name="more" size={15} />
    </button>
  );
}
