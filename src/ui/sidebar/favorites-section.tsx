import { memo, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { noteTitle } from '../../application/index.ts';
import type { ResolvedAppearance } from '../../domain/appearance/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { CustomIcon, iconKey } from '../appearance/look-glyph.tsx';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { useVault } from '../state/vault-store.ts';
import type { MenuTarget } from './menu-items.ts';

const DRAG_TYPE = 'application/x-lite-favorite';

interface FavoriteRowProps {
  readonly path: VaultPath;
  readonly at: number;
  readonly active: boolean;
  readonly dropping: boolean;
  readonly look: ResolvedAppearance | null;
  readonly onMenu: (target: MenuTarget) => void;
  readonly onDragOverRow: (at: number | null) => void;
}

const FavoriteRow = memo(function FavoriteRow({
  path,
  at,
  active,
  dropping,
  look,
  onMenu,
  onDragOverRow,
}: FavoriteRowProps) {
  const icon = look?.icon ?? null;
  const { actions } = useApp();
  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    onMenu({ kind: 'note', path, x: event.clientX, y: event.clientY, favoriteAt: at });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const to = at + (event.key === 'ArrowUp' ? -1 : 1);
      if (to >= 0) actions.moveFavorite(path, to).catch(actions.report);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      onMenu({ kind: 'note', path, x: box.left + 24, y: box.bottom, favoriteAt: at });
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    onDragOverRow(null);
    const dragged = event.dataTransfer.getData(DRAG_TYPE);
    if (dragged !== '') actions.moveFavorite(dragged, at).catch(actions.report);
  };

  return (
    <li
      className={`sidebar-row${active ? ' is-active' : ''}${dropping ? ' is-drop-target' : ''}${icon === null ? '' : ' has-icon'}`}
      data-hue={look?.hue ?? undefined}
      data-look-icon={iconKey(look)}
      draggable
      onDragStart={(event) => event.dataTransfer.setData(DRAG_TYPE, path)}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        onDragOverRow(at);
      }}
      onDragLeave={() => onDragOverRow(null)}
      onDrop={onDrop}
      onContextMenu={openMenu}
    >
      <a
        className="sidebar-row-main"
        href={`#/note/${encodeURIComponent(path)}`}
        aria-current={active ? 'page' : undefined}
        onKeyDown={onKeyDown}
      >
        {icon === null ? null : (
          <span className="tree-row-icon">
            <CustomIcon icon={icon} />
          </span>
        )}
        <span className="sidebar-row-label">{noteTitle(path)}</span>
      </a>
      <button
        type="button"
        className="sidebar-row-action is-on"
        aria-label={`Remove ${noteTitle(path)} from favorites`}
        onClick={() => actions.toggleFavorite(path).catch(actions.report)}
      >
        <Icon name="star" filled />
      </button>
      <button
        type="button"
        className="sidebar-row-action is-more"
        aria-label={`More for ${noteTitle(path)}`}
        title="More"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onMenu({ kind: 'note', path, x: box.left, y: box.bottom, favoriteAt: at });
        }}
      >
        <Icon name="more" size={15} />
      </button>
    </li>
  );
});

/** The favorite notes, above the tree, in their saved order. Drag, or Alt+↑/↓, to reorder. */
export function FavoritesSection({
  activePath,
  onMenu,
}: {
  activePath: VaultPath | null;
  onMenu: (target: MenuTarget) => void;
}) {
  const favorites = useVault((vault) => vault.favorites);
  const looks = useVault((vault) => vault.appearances);
  const [dropAt, setDropAt] = useState<number | null>(null);
  if (favorites.length === 0) return null;

  return (
    <section className="sidebar-section" aria-labelledby="favorites-heading">
      <h2 id="favorites-heading" className="sidebar-heading">
        Favorites
      </h2>
      <ul className="sidebar-list" aria-label="Favorites">
        {favorites.map((path, at) => (
          <FavoriteRow
            key={path}
            path={path}
            at={at}
            active={path === activePath}
            dropping={dropAt === at}
            look={looks.get(path) ?? null}
            onMenu={onMenu}
            onDragOverRow={setDropAt}
          />
        ))}
      </ul>
    </section>
  );
}
