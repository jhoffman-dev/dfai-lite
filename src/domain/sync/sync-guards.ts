import { INDEX_FOLDER, isNotePath, isWithin, type VaultPath } from '../vault/index.ts';

/**
 * A sync stops and asks before it commits the deletion of more than this
 * many notes AND more than this share of the notes git tracks: an iCloud
 * eviction, an interrupted clone or the wrong folder looks exactly like
 * deleting them, and a push would delete them on every other Mac. A handful,
 * or a few in a small vault, is someone tidying up.
 */
export const MASS_DELETION_NOTES = 20;
export const MASS_DELETION_SHARE = 0.1;

const isSyncedNote = (path: VaultPath) => isNotePath(path) && !isWithin(path, INDEX_FOLDER);

/** The notes a commit would delete when that many needs a person's yes; empty when it does not. */
export function deletionsToConfirm({
  deleted,
  tracked,
}: {
  /** Paths git sees as deleted. */
  deleted: readonly VaultPath[];
  /** Every path git tracks. */
  tracked: readonly VaultPath[];
}): VaultPath[] {
  const notes = deleted.filter(isSyncedNote);
  const trackedNotes = tracked.filter(isSyncedNote).length;
  const many =
    notes.length > MASS_DELETION_NOTES && notes.length > trackedNotes * MASS_DELETION_SHARE;
  return many ? notes : [];
}

/** iCloud's stand-in for a file it moved off this Mac: `.<name>.icloud` beside where it was. */
const ICLOUD_STUB = /(^|\/)\.[^/]+\.icloud$/;

/** The iCloud stand-ins among these paths: each means a note that only looks deleted. */
export function icloudStubs(paths: readonly VaultPath[]): VaultPath[] {
  return paths.filter((path) => ICLOUD_STUB.test(path));
}

const BEGIN =
  '# >>> DFAI Lite keeps these out of sync. It rewrites only the lines up to the end mark.';
const END = '# <<< DFAI Lite';
/** Always kept out: a write's temporary file, Finder's, Claude Code's own and secrets. */
const ALWAYS = ['*.dfai-lite-tmp', '.DS_Store', '.claude/', '.env', '.env.*'];

/** A vault path as an ignore line matching that path alone, from the vault's top. */
function ignoreLine(path: VaultPath, folder: boolean): string {
  return `/${path.replace(/[\\*?[\]!# ]/g, '\\$&')}${folder ? '/' : ''}`;
}

/**
 * The vault's `.gitignore` with the app's own block: added at the end when
 * absent, its lines replaced when present, every other line kept as it is.
 * `skipped` are files git must not be given (over GitHub's limit) and
 * `nested` folders that are repositories of their own.
 */
export function withIgnoreBlock(
  current: string | null,
  { skipped, nested }: { skipped: readonly VaultPath[]; nested: readonly VaultPath[] },
): string {
  const block = [
    BEGIN,
    ...ALWAYS,
    ...skipped.map((path) => ignoreLine(path, false)),
    ...nested.map((path) => ignoreLine(path, true)),
    END,
  ];
  if (current === null || current === '') return `${block.join('\n')}\n`;
  const lines = current.split('\n');
  const start = lines.indexOf(BEGIN);
  const stop = start < 0 ? -1 : lines.indexOf(END, start);
  if (start >= 0 && stop > start) {
    return [...lines.slice(0, start), ...block, ...lines.slice(stop + 1)].join('\n');
  }
  const ends = current.endsWith('\n') ? current : `${current}\n`;
  return `${ends}\n${block.join('\n')}\n`;
}
