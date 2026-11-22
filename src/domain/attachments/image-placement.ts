import { folderOf, type VaultPath } from '../vault/note-path.ts';

/**
 * What the note writes in `![alt](…)` to reach `imagePath`: relative to the
 * note's folder, climbing with `../` where it has to, with each segment
 * percent-encoded.
 *
 * Relative, because both Obsidian and every CommonMark tool resolve a link
 * from the note's own folder. Percent-encoded rather than in `<…>`, because a
 * destination with a space is only a link in CommonMark inside angle brackets,
 * which some tools do not read, while `%20` every one of them — Obsidian
 * included — decodes. Brackets and parentheses are encoded too, so the
 * destination never needs escaping.
 */
export function relativeImageSource({
  notePath,
  imagePath,
}: {
  notePath: VaultPath;
  imagePath: VaultPath;
}): string {
  const from = segments(folderOf(notePath));
  const to = segments(imagePath);
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) {
    shared += 1;
  }
  const climbs = from.slice(shared).map(() => '..');
  return [...climbs, ...to.slice(shared).map(encodeSegment)].join('/');
}

/** A markdown image destination, decoded back to the path it names. Undecodable text is kept as written. */
export function decodeImageSource(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    // A lone `%` that is not an escape: the source names a file with a `%` in it.
    return src;
  }
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const segments = (path: VaultPath): string[] => (path === '' ? [] : path.split('/'));
