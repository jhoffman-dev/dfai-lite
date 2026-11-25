import type { VaultEntry, VaultPath } from '../../domain/vault/index.ts';
import type { NoteActions } from '../state/note-actions.ts';
import type { MenuItem } from './row-menu.tsx';

/** What a context menu was opened on, and where. */
export type MenuTarget =
  | {
      readonly kind: 'note';
      readonly path: VaultPath;
      readonly x: number;
      readonly y: number;
      /** Where it sits in the favorites, when opened there; null in the tree. */
      readonly favoriteAt: number | null;
    }
  | { readonly kind: 'folder'; readonly path: VaultPath; readonly x: number; readonly y: number };

export interface MenuContext {
  readonly actions: NoteActions;
  readonly favorites: readonly VaultPath[];
  readonly title: (path: VaultPath) => string;
  /** Opens the folder picker for a new home. */
  readonly askMove: (entry: VaultEntry) => void;
  readonly askRenameFolder: (path: VaultPath) => void;
  /** Starts naming a new folder in place, in `parent`. */
  readonly startNewFolder: (parent: VaultPath) => void;
  /** Opens the icon and color picker for the row, where the menu was. */
  readonly askAppearance: (target: MenuTarget) => void;
}

function favoriteMoves(path: VaultPath, at: number, context: MenuContext): MenuItem[] {
  const { actions, favorites } = context;
  const moves: MenuItem[] = [];
  const later = (promise: Promise<void>) => void promise.catch(actions.report);
  if (at > 0)
    moves.push({ label: 'Move up', run: () => later(actions.moveFavorite(path, at - 1)) });
  if (at < favorites.length - 1) {
    moves.push({ label: 'Move down', run: () => later(actions.moveFavorite(path, at + 1)) });
  }
  return moves;
}

export function menuItemsFor(target: MenuTarget, context: MenuContext): MenuItem[] {
  const { actions } = context;
  const later = (promise: Promise<unknown>) => void promise.catch(actions.report);
  if (target.kind === 'folder') {
    const { path } = target;
    return [
      { label: 'New note here', run: () => later(actions.newNote({ folder: path })) },
      { label: 'New folder here', run: () => context.startNewFolder(path) },
      { label: 'Rename folder…', run: () => context.askRenameFolder(path) },
      { label: 'Move to…', run: () => context.askMove({ kind: 'folder', path }) },
      { label: 'Icon & color…', run: () => context.askAppearance(target) },
      { label: 'Delete folder…', danger: true, run: () => later(actions.deleteFolder(path)) },
    ];
  }
  const { path } = target;
  const isFavorite = context.favorites.includes(path);
  return [
    { label: 'Open in new tab', run: () => actions.openNote(path, 'new-tab') },
    { label: 'Open to the side', run: () => actions.openNote(path, 'side') },
    { label: 'Open mind map', run: () => actions.openMap({ kind: 'note', path }) },
    { label: 'Rename', run: () => actions.startRename(path) },
    { label: 'Move to…', run: () => context.askMove({ kind: 'note', path }) },
    { label: 'Icon & color…', run: () => context.askAppearance(target) },
    {
      label: isFavorite ? 'Remove from favorites' : 'Add to favorites',
      run: () => later(actions.toggleFavorite(path)),
    },
    ...(target.favoriteAt === null ? [] : favoriteMoves(path, target.favoriteAt, context)),
    {
      label: 'Delete…',
      danger: true,
      run: () => {
        const message = `Delete “${context.title(path)}”? It goes to the Trash.`;
        later(
          actions
            .ask({ message, yes: 'Delete' })
            .then((yes) => (yes ? actions.remove(path) : undefined)),
        );
      },
    },
  ];
}
