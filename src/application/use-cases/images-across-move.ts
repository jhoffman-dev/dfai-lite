import { retargetImageSources } from '../../domain/markdown/index.ts';
import { foldedPath, type PathMove, type VaultPath } from '../../domain/vault/index.ts';
import type { VaultDeps } from './vault-deps.ts';

/**
 * Whether a file is in the vault, as the session holds it. Made once per
 * move, after the session has it, so it knows where every file is now.
 */
export function filesNow({ session }: VaultDeps): (path: VaultPath) => boolean {
  // Case aside, as the Mac's disk finds a file: `attachments/x.png` is in `Attachments/`.
  const files = new Set(session.takenPaths().map(foldedPath));
  return (path) => files.has(foldedPath(path));
}

/**
 * `text`, of the note now at `path`, with each relative image source the
 * move broke re-pointed at where the image is now.
 */
export function imagesFollowingMove({
  text,
  path,
  move,
  exists,
}: {
  text: string;
  path: VaultPath;
  move: PathMove;
  exists: (path: VaultPath) => boolean;
}): { text: string; count: number } {
  if (!text.includes('![')) return { text, count: 0 };
  return retargetImageSources({ text, path, move, exists });
}
