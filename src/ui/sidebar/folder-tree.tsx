import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { flattenFolderTree, folderOf, isWithin } from '../../application/index.ts';
import type { TreeRow, VaultPath } from '../../domain/vault/index.ts';
import { DragTile } from './drag-tile.tsx';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { useUi } from '../state/ui-store.ts';
import { useVault } from '../state/vault-store.ts';
import { useExpandedFolders } from './expanded-folders.ts';
import type { MenuTarget } from './menu-items.ts';
import { NewFolderRow } from './new-folder-row.tsx';
import { useTreeDrag } from './tree-drag.ts';
import { INDENT, menuTargetOf, ROW_HEIGHT, RowMore, TreeRowView } from './tree-row.tsx';
import './tree-dnd.css';

/** One line of the list: a row of the tree, or the new folder being named. */
type ListRow =
  TreeRow | { readonly kind: 'naming'; readonly path: VaultPath; readonly depth: number };

/** The rows with the new folder's name field first in its folder, while one is being named. */
function withNamingRow(rows: TreeRow[], parent: VaultPath | null): ListRow[] {
  if (parent === null) return rows;
  if (parent === '') return [{ kind: 'naming', path: '', depth: 0 }, ...rows];
  const at = rows.findIndex((row) => row.kind === 'folder' && row.path === parent);
  if (at === -1) return rows;
  const naming = { kind: 'naming' as const, path: parent, depth: (rows[at]?.depth ?? 0) + 1 };
  return [...rows.slice(0, at + 1), naming, ...rows.slice(at + 1)];
}

/** Arrow keys walk the rows; Enter, Space and ←/→ open and close folders; the menu key opens a row's menu. */
function treeKeys({
  rows,
  current,
  focusRow,
  toggle,
  onMenu,
}: {
  rows: readonly ListRow[];
  current: number;
  focusRow: (index: number) => void;
  toggle: (path: VaultPath) => void;
  onMenu: (target: MenuTarget) => void;
}) {
  return (event: KeyboardEvent) => {
    const row = rows[current];
    if (row === undefined || row.kind === 'naming') return;
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      focusRow(current + (key === 'ArrowDown' ? 1 : -1));
    } else if (key === 'Home' || key === 'End') {
      focusRow(key === 'Home' ? 0 : rows.length - 1);
    } else if (row.kind === 'folder' && (key === 'Enter' || key === ' ')) {
      toggle(row.path);
    } else if (row.kind === 'folder' && key === (row.expanded ? 'ArrowLeft' : 'ArrowRight')) {
      toggle(row.path);
    } else if (key === 'ArrowLeft' && row.depth > 0) {
      const parent = folderOf(row.path);
      focusRow(rows.findIndex((other) => other.kind === 'folder' && other.path === parent));
    } else if (key === 'ContextMenu' || (event.shiftKey && key === 'F10')) {
      const box = (event.target as HTMLElement).getBoundingClientRect();
      onMenu(menuTargetOf(row, { x: box.left + 24, y: box.bottom }));
    } else {
      return;
    }
    event.preventDefault();
  };
}

/**
 * The vault's folders and notes, virtualized so a 2,000-note vault scrolls
 * as one of ten. Rows drag onto folders, or onto the space around them for
 * the top of the vault; a new folder is named in place.
 */
export function FolderTree({
  activePath,
  onMenu,
}: {
  activePath: VaultPath | null;
  onMenu: (target: MenuTarget) => void;
}) {
  const { ui } = useApp();
  const tree = useVault((vault) => vault.tree);
  const namingIn = useUi((state) => state.namingFolderIn);
  const { expanded, toggle, expand } = useExpandedFolders(activePath);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useTreeDrag({ tree, scroller, expand, isOpen: (folder) => expanded.has(folder) });
  const rows = useMemo(
    () => withNamingRow(flattenFolderTree(tree, expanded), namingIn),
    [tree, expanded, namingIn],
  );
  const [focusIndex, setFocusIndex] = useState(0);
  const current = Math.min(focusIndex, Math.max(0, rows.length - 1));
  const heldPath = drag.held?.path ?? null;
  const heldAt = heldPath === null ? -1 : rows.findIndex((row) => row.path === heldPath);
  const keepHeldRow = useCallback(
    (range: Range) => {
      const shown = defaultRangeExtractor(range);
      if (heldAt === -1 || shown.includes(heldAt)) return shown;
      return [...shown, heldAt].sort((left, right) => left - right);
    },
    [heldAt],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // The dragged row stays drawn though scrolled away: its element is where its dragend is heard.
    rangeExtractor: keepHeldRow,
  });

  // Rows changing mid-drag keep the one under the pointer where it is.
  const rowsBefore = useRef(rows);
  const { keepHoveredRow } = drag;
  useLayoutEffect(() => {
    keepHoveredRow(rowsBefore.current, rows);
    rowsBefore.current = rows;
  }, [rows, keepHoveredRow]);
  const target = drag.target;
  const inTarget = (path: VaultPath) =>
    target !== null && target !== '' && path !== target && isWithin(path, target);

  // Naming a folder inside another opens it, so the field shows where the folder goes.
  useEffect(() => {
    if (namingIn !== null) expand(namingIn);
  }, [namingIn, expand]);

  const openMenu = useCallback(
    (row: TreeRow, event: MouseEvent) => {
      event.preventDefault();
      onMenu(menuTargetOf(row, { x: event.clientX, y: event.clientY }));
    },
    [onMenu],
  );

  const focusRow = (index: number) => {
    const at = Math.max(0, Math.min(rows.length - 1, index));
    setFocusIndex(at);
    virtualizer.scrollToIndex(at);
    requestAnimationFrame(() =>
      scroller.current?.querySelector<HTMLElement>(`[data-index="${at}"]`)?.focus(),
    );
  };

  return (
    <section
      className={`sidebar-section sidebar-tree${target === '' ? ' is-drop-root' : ''}`}
      aria-labelledby="notes-heading"
      {...drag.zone}
    >
      <div className="tree-heading">
        <h2 id="notes-heading" className="sidebar-heading">
          Notes
        </h2>
        <button
          type="button"
          className="tree-heading-action"
          aria-label="New folder"
          title="New folder"
          onClick={() => ui.setState({ namingFolderIn: '' })}
        >
          <Icon name="folder-plus" size={15} />
        </button>
      </div>
      <div
        ref={scroller}
        className="tree-scroller"
        role="tree"
        aria-label="Notes"
        onKeyDown={treeKeys({ rows, current, focusRow, toggle, onMenu })}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index] as ListRow;
            return (
              <div
                key={`${row.kind}:${row.path}`}
                className={`tree-slot${inTarget(row.path) ? ' is-in-drop-target' : ''}`}
                style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                // What a drag over this slot points at, read by `useTreeDrag`.
                data-entry-kind={row.kind}
                data-entry-path={row.path}
              >
                {row.kind === 'naming' ? (
                  <NewFolderRow
                    parent={row.path}
                    indent={8 + row.depth * INDENT}
                    onMade={(path) => expand(folderOf(path))}
                    onDone={() => ui.setState({ namingFolderIn: null })}
                  />
                ) : (
                  <>
                    <TreeRowView
                      row={row}
                      index={item.index}
                      active={row.path === activePath}
                      focusable={item.index === current}
                      dropTarget={row.kind === 'folder' && target === row.path}
                      dragged={row.path === heldPath}
                      onDragStart={drag.start}
                      onToggle={toggle}
                      onMenu={openMenu}
                      onFocusRow={setFocusIndex}
                    />
                    <RowMore row={row} onMenu={onMenu} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {drag.held !== null && <DragTile entry={drag.held} tileRef={drag.tile} />}
    </section>
  );
}
