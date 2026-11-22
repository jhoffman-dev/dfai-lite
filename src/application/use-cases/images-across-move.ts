import { retargetImageSources } from '../../domain/markdown/index.ts';
import type { PathMove, VaultPath } from '../../domain/vault/index.ts';
import type { VaultDeps } from './vault-deps.ts';

/**
 * Whether a file is in the vault, as the session holds it. Made once per
 * move, after the session has it, so it knows where every file is now.
 */
export function filesNow({ session }: VaultDeps): (path: VaultPath) => boolean {
  const files = new Set(session.takenPaths());
  return (path) => files.has(path);
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
