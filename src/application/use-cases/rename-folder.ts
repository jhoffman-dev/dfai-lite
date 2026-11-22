import { favoritesAfterMove } from '../../domain/favorites/index.ts';
import {
  linkKeysOf,
  moveResolvers,
  notesAfterMove,
  retargetLinks,
} from '../../domain/links/index.ts';
import {
  folderPathProblem,
  foldedPath,
  isWithin,
  pathAfterMove,
  type PathMove,
  type VaultPath,
} from '../../domain/vault/index.ts';
import { appearancesFollowMove } from './appearance.ts';
import { writeFavorites } from './favorites.ts';
import { followMoveInLedger } from './import-ledger.ts';
import { filesNow, imagesFollowingMove } from './images-across-move.ts';
import { writeFile, type VaultDeps } from './vault-deps.ts';

export type RenameFolderResult =
  | {
      readonly kind: 'renamed';
      /** Notes moved. */
      readonly moved: number;
      /** Links rewritten to follow them. */
      readonly retargeted: number;
    }
  | { readonly kind: 'refused'; readonly reason: string };

/** Why the folder cannot go to `to`: the shared folder rules, itself, or anything already there. */
function folderProblem(deps: VaultDeps, { from, to }: PathMove): string | null {
  const problem = folderPathProblem(to);
  if (problem !== null) return problem;
  // A change of case alone is the same folder: nothing else is in its way.
  if (foldedPath(to) === foldedPath(from)) return null;
  if (isWithin(to, from)) return 'A folder cannot move inside itself.';
  const wanted = foldedPath(to);
  const taken = [...deps.session.folders(), ...deps.session.takenPaths()];
  const clash = taken.find((other) => foldedPath(other) === wanted);
  return clash === undefined ? null : `Something is already at ${clash}.`;
}

/** The notes whose links a move may break: every note linking to a note moved, by name or path. */
function linkersOf(deps: VaultDeps, move: PathMove): readonly VaultPath[] {
  const index = deps.session.index;
  const keys = index
    .paths()
    .filter((path) => isWithin(path, move.from))
    .flatMap((path) => [...linkKeysOf(path), ...linkKeysOf(pathAfterMove(path, move) ?? path)]);
  return index.linkSources(keys);
}

const NO_LINKS = (text: string) => ({ text, count: 0 });

/** The notes that show a picture (`![`), which a folder's move may break, but for its link sources. */
function picturesOf(deps: VaultDeps): VaultPath[] {
  return [...deps.session.allFiles()]
    .filter((file) => file.text.includes('!['))
    .map((file) => file.path);
}

/**
 * Renames or moves a folder: the folder itself moves on disk, in one step,
 * with everything in it (notes, attachments, folders, dot files), so an
 * image a note shows never stays behind and a change of case is real. Then
 * every link the move broke is rewritten, and every relative image source
 * (in a note that moved, or reaching into the folder), as DFAI does; and
 * favorites and the icons and colors follow. Checked
 * first; if the disk refuses, nothing in the session or the links changes.
 */
export async function renameFolder(deps: VaultDeps, move: PathMove): Promise<RenameFolderResult> {
  if (move.from === move.to) return { kind: 'renamed', moved: 0, retargeted: 0 };
  const problem = folderProblem(deps, move);
  if (problem !== null) return { kind: 'refused', reason: problem };

  const across = notesAfterMove(move, deps.session.index.paths());
  const resolvers = moveResolvers(across);
  const sources = linkersOf(deps, move);
  await deps.files.renameFolder(move.from, move.to);
  deps.session.applyFolderMove(move);

  let retargeted = 0;
  const exists = filesNow(deps);
  const linkers = new Set(sources.map((source) => pathAfterMove(source, move) ?? source));
  for (const path of new Set([...linkers, ...picturesOf(deps)])) {
    const file = deps.session.file(path);
    if (file === null) continue;
    const links = linkers.has(path) ? retargetLinks(file.text, resolvers) : NO_LINKS(file.text);
    const images = imagesFollowingMove({ text: links.text, path, move, exists });
    if (links.count + images.count === 0) continue;
    retargeted += links.count + images.count;
    await writeFile(deps, path, images.text);
  }
  await writeFavorites(deps, favoritesAfterMove(deps.session.favorites, move));
  await appearancesFollowMove(deps, move);
  await followMoveInLedger(deps, move);
  return { kind: 'renamed', moved: across.moved.size, retargeted };
}
