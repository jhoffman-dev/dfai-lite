import { favoritesAfterMove } from '../../domain/favorites/index.ts';
import {
  linkKeysOf,
  moveResolvers,
  notesAfterMove,
  retargetLinks,
} from '../../domain/links/index.ts';
import {
  foldedPath,
  isNotePath,
  noteNameProblem,
  withoutExtension,
  type VaultPath,
} from '../../domain/vault/index.ts';
import { appearancesFollowMove } from './appearance.ts';
import { writeFavorites } from './favorites.ts';
import { filesNow, imagesFollowingMove } from './images-across-move.ts';
import { writeFile, type VaultDeps } from './vault-deps.ts';

export type RenameResult =
  | {
      readonly kind: 'renamed';
      readonly path: VaultPath;
      /** How many links in the vault were rewritten to follow it. */
      readonly retargeted: number;
    }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Renames or moves a note to `to` (a full path, `.md` included), rewriting
 * every link the move would break, in every note, and following it in the
 * favorites and the icons and colors. Its pictures stay where they are; a relative image source the
 * move would break is rewritten from the note's new folder, as DFAI does. Refused when the new name breaks the file-name rules or
 * another file already has the path, case aside.
 */
export async function renameNote(
  deps: VaultDeps,
  { from, to }: { from: VaultPath; to: VaultPath },
): Promise<RenameResult> {
  const file = deps.session.file(from);
  if (file === null) return { kind: 'refused', reason: `There is no note at ${from}.` };
  if (to === from) return { kind: 'renamed', path: to, retargeted: 0 };
  const problem = renameProblem(deps, from, to);
  if (problem !== null) return { kind: 'refused', reason: problem };

  const index = deps.session.index;
  const resolvers = moveResolvers(notesAfterMove({ from, to }, index.paths()));
  const sources = index.linkSources([...linkKeysOf(from), ...linkKeysOf(to)]);

  const links = retargetLinks(file.text, resolvers);
  await deps.files.rename(from, to);
  deps.session.applyRename(from, { path: to, text: file.text });
  const images = imagesFollowingMove({
    text: links.text,
    path: to,
    move: { from, to },
    exists: filesNow(deps),
  });
  const own = { text: images.text, count: links.count + images.count };
  if (own.text !== file.text) await writeFile(deps, to, own.text);

  let retargeted = own.count;
  for (const source of sources) {
    const other = source === from ? null : deps.session.file(source);
    if (other === null) continue;
    const result = retargetLinks(other.text, resolvers);
    if (result.count === 0) continue;
    retargeted += result.count;
    await writeFile(deps, source, result.text);
  }
  await writeFavorites(deps, favoritesAfterMove(deps.session.favorites, { from, to }));
  await appearancesFollowMove(deps, { from, to });
  return { kind: 'renamed', path: to, retargeted };
}

function renameProblem(deps: VaultDeps, from: VaultPath, to: VaultPath): string | null {
  if (!isNotePath(to)) return 'A note’s path ends in .md.';
  for (const part of withoutExtension(to).split('/')) {
    const problem = noteNameProblem(part);
    if (problem !== null) return problem;
  }
  const wanted = foldedPath(to);
  for (const other of deps.session.takenPaths()) {
    if (other !== from && foldedPath(other) === wanted) return `A note is already at ${other}.`;
  }
  return null;
}
