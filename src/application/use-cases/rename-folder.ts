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
import { writeFavorites } from './favorites.ts';
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

/**
 * Renames or moves a folder: the folder itself moves on disk, in one step,
 * with everything in it (notes, attachments, folders, dot files), so an
 * image a note shows never stays behind and a change of case is real. Then
 * every link the move broke is rewritten and favorites follow. Checked
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
  for (const source of sources) {
    const path = pathAfterMove(source, move) ?? source;
    const file = deps.session.file(path);
    if (file === null) continue;
    const result = retargetLinks(file.text, resolvers);
    if (result.count === 0) continue;
    retargeted += result.count;
    await writeFile(deps, path, result.text);
  }
  await writeFavorites(deps, favoritesAfterMove(deps.session.favorites, move));
  return { kind: 'renamed', moved: across.moved.size, retargeted };
}
