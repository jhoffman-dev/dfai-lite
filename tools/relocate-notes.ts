// Moves notes and folders of a vault held in memory, the way the app moves
// them: every wiki link and markdown image that the move would break is
// re-pointed, and favorites follow. Pure, so it is tested without a disk.
import { favoritesAfterMove } from '../src/domain/favorites/index.ts';
import { moveResolvers, notesAfterMove, retargetLinks } from '../src/domain/links/index.ts';
import { retargetImageSources } from '../src/domain/markdown/index.ts';
import { pathAfterMove, type PathMove } from '../src/domain/vault/index.ts';

export interface VaultInMemory {
  /** Each note's path and text. */
  readonly notes: ReadonlyMap<string, string>;
  /** Every other file's path (pictures and the like), carried by moves but never read. */
  readonly files: readonly string[];
  readonly favorites: readonly string[];
}

export interface Relocated {
  readonly vault: VaultInMemory;
  /** Each path, note or file, that moved: from where it was before the first move to where it ended. */
  readonly moved: ReadonlyMap<string, string>;
  readonly linksRewritten: number;
  readonly imagesRewritten: number;
}

/** Applies `moves` one after another, each seeing the vault the move before it left. */
export function relocate(start: VaultInMemory, moves: readonly PathMove[]): Relocated {
  let vault = start;
  let linksRewritten = 0;
  let imagesRewritten = 0;
  const origin = new Map<string, string>(
    [...start.notes.keys(), ...start.files].map((path) => [path, path]),
  );
  for (const move of moves) {
    const step = applyMove(vault, move);
    vault = step.vault;
    linksRewritten += step.linksRewritten;
    imagesRewritten += step.imagesRewritten;
    for (const [first, current] of origin)
      origin.set(first, pathAfterMove(current, move) ?? current);
  }
  const moved = new Map([...origin].filter(([first, last]) => first !== last));
  return { vault, moved, linksRewritten, imagesRewritten };
}

function applyMove(
  vault: VaultInMemory,
  move: PathMove,
): { vault: VaultInMemory; linksRewritten: number; imagesRewritten: number } {
  const across = notesAfterMove(move, [...vault.notes.keys()]);
  const resolvers = moveResolvers(across);
  const files = vault.files.map((path) => pathAfterMove(path, move) ?? path);
  const present = new Set([...across.after, ...files]);
  const exists = (path: string): boolean => present.has(path);
  let linksRewritten = 0;
  let imagesRewritten = 0;
  const notes = new Map<string, string>();
  for (const [before, text] of vault.notes) {
    const path = across.moved.get(before) ?? before;
    const links = retargetLinks(text, resolvers);
    const images = retargetImageSources({ text: links.text, path, move, exists });
    linksRewritten += links.count;
    imagesRewritten += images.count;
    notes.set(path, images.text);
  }
  const favorites = favoritesAfterMove(vault.favorites, move);
  return { vault: { notes, files, favorites }, linksRewritten, imagesRewritten };
}
