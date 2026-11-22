import { cleanNoteName } from './file-name.ts';
import { foldedPath, joinPath, type VaultPath } from './note-path.ts';

/** Where a quick note goes: notes with no obvious home (the vault contract). */
/**
 * The folder at the vault root that pasted and dropped pictures go in, as
 * Obsidian's does, and as DFAI saves them by default. (DFAI can also be set
 * to save beside the note; Lite has no setting for it.)
 */
export const ATTACHMENTS_FOLDER = 'attachments';

export const INBOX_FOLDER = 'Inbox';

/** The name a note is given when none is typed. */
export const DEFAULT_NOTE_NAME = 'Untitled';

/**
 * The first free path for a note called `name` in `folder`: `Name.md`, then
 * `Name 2.md`, `Name 3.md`… A path is taken when one in `taken` matches it
 * case aside, since macOS and Windows would see them as one file. A name with
 * nothing usable in it becomes {@link DEFAULT_NOTE_NAME}.
 */
export function uniqueNotePath({
  folder,
  name = DEFAULT_NOTE_NAME,
  taken,
}: {
  folder: VaultPath;
  name?: string;
  taken: Iterable<VaultPath>;
}): VaultPath {
  const base = cleanNoteName(name) || DEFAULT_NOTE_NAME;
  const used = new Set<string>();
  for (const path of taken) used.add(foldedPath(path));
  for (let number = 1; ; number += 1) {
    const path = joinPath(folder, `${number === 1 ? base : `${base} ${number}`}.md`);
    if (!used.has(foldedPath(path))) return path;
  }
}
