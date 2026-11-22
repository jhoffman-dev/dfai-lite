import {
  APPEARANCE_PATH,
  appearancesAfterDelete,
  appearancesAfterMove,
  pruneAppearances,
  serializeAppearances,
  setAppearance,
  type AppearancePatch,
  type Appearances,
} from '../../domain/appearance/index.ts';
import type { PathMove, VaultPath } from '../../domain/vault/index.ts';
import { writeFile, type VaultDeps } from './vault-deps.ts';

/** The appearance file could not be read, so a change to it is not written over what it holds. */
export class AppearanceUnreadableError extends Error {
  override readonly name = 'AppearanceUnreadableError';
}

/**
 * Writes the appearance file when the looks changed, in one write. A file
 * that could not be read is never written over: what it holds may be a
 * newer version's or a hand edit, and is the person's to fix.
 */
async function writeAppearances(deps: VaultDeps, appearances: Appearances): Promise<void> {
  const problem = deps.session.appearancesProblem;
  if (problem !== null) {
    throw new AppearanceUnreadableError(`${problem} Fix or remove it to change icons and colors.`);
  }
  const text = serializeAppearances(appearances);
  const held = deps.session.file(APPEARANCE_PATH)?.text ?? null;
  if (text === held || (held === null && appearances.size === 0)) return;
  await writeFile(deps, APPEARANCE_PATH, text);
}

/**
 * Follows a rename, move or delete the app just made. An unreadable file is
 * left alone, as it is: the note's own change has happened and stands.
 */
async function followInAppearances(
  deps: VaultDeps,
  change: (appearances: Appearances) => Appearances,
): Promise<void> {
  if (deps.session.appearancesProblem !== null) return;
  await writeAppearances(deps, change(deps.session.appearances));
}

/** Sets or clears a folder's or a note's color and icon: a string sets, null clears, absent keeps. */
export async function setPathAppearance(
  deps: VaultDeps,
  { path, ...patch }: { path: VaultPath } & AppearancePatch,
): Promise<void> {
  await writeAppearances(deps, setAppearance(deps.session.appearances, path, patch));
}

/** The looks follow a note or a folder the app just moved. */
export function appearancesFollowMove(deps: VaultDeps, move: PathMove): Promise<void> {
  return followInAppearances(deps, (appearances) => appearancesAfterMove(appearances, move));
}

/** The looks lose a note the app just deleted. */
export function appearancesFollowDelete(deps: VaultDeps, path: VaultPath): Promise<void> {
  return followInAppearances(deps, (appearances) => appearancesAfterDelete(appearances, path));
}

/** The looks lose what at or under `within` the app just removed; what it kept keeps its look. */
export function appearancesFollowRemoval(deps: VaultDeps, within: VaultPath): Promise<void> {
  const { session } = deps;
  const folders = new Set(session.folders());
  const exists = (path: VaultPath) => session.file(path) !== null || folders.has(path);
  return followInAppearances(deps, (appearances) =>
    pruneAppearances(appearances, { within, exists }),
  );
}
