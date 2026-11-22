import { memo, type DragEvent, type MouseEvent } from 'react';
import type { ResolvedAppearance } from '../../domain/appearance/index.ts';
import type { TreeRow, VaultEntry, VaultPath } from '../../domain/vault/index.ts';
import { CustomIcon, iconKey } from '../appearance/look-glyph.tsx';
import { Icon } from '../shell/icons.tsx';
import type { MenuTarget } from './menu-items.ts';
import './row-look.css';

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
  /** Its icon and color, or null for the default. Kept as one object per look, so memo holds. */
  readonly look: ResolvedAppearance | null;
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
  look,
  onDragStart,
  onToggle,
  onMenu,
  onFocusRow,
}: TreeRowProps) {
  const isFolder = row.kind === 'folder';
  const icon = look?.icon ?? null;
  const common = {
    role: 'treeitem',
    'data-index': index,
    'data-kind': row.kind,
    // A colored row is a box in its hue (row-look.css); the icon is for tests and styles to read.
    'data-hue': look?.hue ?? undefined,
    'data-look-icon': iconKey(look),
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
        {icon === null ? (
          <span className={`tree-chevron${row.expanded ? ' is-open' : ''}`}>
            <Icon name="chevron" />
          </span>
        ) : (
          <span className="tree-row-icon">
            <CustomIcon icon={icon} />
          </span>
        )}
        <span className="sidebar-row-label">{row.name}</span>
        <span className="tree-count">{row.noteCount}</span>
      </div>
    );
  }
  return (
    <a
      {...common}
      className={`tree-row is-note${active ? ' is-active' : ''}${icon === null ? '' : ' has-icon'}${faded}`}
      href={`#/note/${encodeURIComponent(row.path)}`}
      aria-current={active ? 'page' : undefined}
      aria-selected={active}
    >
      {icon === null ? null : (
        <span className="tree-row-icon is-note-icon">
          <CustomIcon icon={icon} />
        </span>
      )}
      <span className="sidebar-row-label">{row.name}</span>
    </a>
  );
});

/** The "…" beside a row, shown on hover and focus: the row's menu, without knowing to right-click. */
export function RowMore({
  row,
  hue,
  onMenu,
}: {
  row: TreeRow;
  /** The row's hue, so the button reads on its fill. */
  hue: string | null;
  onMenu: (target: MenuTarget) => void;
}) {
  return (
    <button
      type="button"
      className="tree-row-more"
      data-hue={hue ?? undefined}
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
