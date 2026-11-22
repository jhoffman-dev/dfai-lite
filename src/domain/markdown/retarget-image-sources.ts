import { relativeImageSource } from '../attachments/image-placement.ts';
import { isWithin, pathAfterMove, type PathMove, type VaultPath } from '../vault/note-path.ts';
import { imageSourceCandidates } from './image-source.ts';

/** A move of a note or a folder, as the image sources of one note see it. */
export interface ImageSourcesAcrossMove {
  readonly move: PathMove;
  /** Where the note holding the text is now, after the move. */
  readonly path: VaultPath;
  /** Whether a file is in the vault after the move: how an image source is followed. */
  readonly exists: (path: VaultPath) => boolean;
}

// `![alt](destination`: the destination in `<…>`, or bare with balanced
// parentheses and backslash escapes, as CommonMark reads one.
const IMAGE =
  /!\[(?:\\.|[^\\\]\n])*\]\([ \t]*(<(?:\\.|[^\\<>\n])*>|(?:\\.|[^\s()\\]|\((?:\\.|[^\s()\\])*\))+)/g;
const EXTERNAL = /^(https?:|data:)/i;

// A fenced block, from its opening fence to the matching close (or the end),
// and an inline code span: an image source inside either is text.
const CODE =
  /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[`~]*[ \t]*$|(?![\s\S]))|(`+)[^`\n][\s\S]*?\3/gm;

/** Whether an offset in `text` falls in a fenced block or a code span. */
function codeRanges(text: string): (at: number) => boolean {
  const code = [...text.matchAll(CODE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  return (at) => code.some((range) => at >= range.start && at < range.end);
}

/** Every `![…](src)` in `text` outside code: the source as it names a file, and where its bytes are. */
function imageDestinations(text: string) {
  const inCode = codeRanges(text);
  return [...text.matchAll(IMAGE)].flatMap((match) => {
    const written = match[1] ?? '';
    const start = match.index + match[0].length - written.length;
    if (inCode(match.index)) return [];
    const bare = written.startsWith('<') ? written.slice(1, -1) : written;
    const src = bare.replace(/\\([!-/:-@[-`{-~])/g, '$1');
    if (src.trim() === '' || EXTERNAL.test(src.trim())) return [];
    return [{ src, start, end: start + written.length }];
  });
}

/**
 * The note's path before the move. Whatever is under the move's target now
 * was carried there by it: a move never lands on anything already there.
 */
function pathBefore({ move, path }: ImageSourcesAcrossMove): VaultPath {
  if (path === move.to) return move.from;
  return isWithin(path, move.to) ? `${move.from}${path.slice(move.to.length)}` : path;
}

/** Each place `src` could have meant before the move, with where it is now. */
function placesNow(src: string, across: ImageSourcesAcrossMove) {
  return imageSourceCandidates({ src, notePath: pathBefore(across) }).map((then) => {
    const now = pathAfterMove(then, across.move);
    return { now: now ?? then, moved: now !== null };
  });
}

/**
 * Re-points every relative image source a move broke, as DFAI does: one in
 * a moved note, or one reaching into a moved folder. The image is found
 * where it was before the move — beside the note, else from the vault root —
 * and followed to where it is now. When the note or the image moved, and the
 * source read from the note's folder no longer names it, the source is
 * rewritten relative to the note: the form every markdown tool reads. Just
 * the destination's bytes change. An image found in neither place is left
 * alone: rewriting it would be a guess.
 */
export function retargetImageSources({
  text,
  ...across
}: ImageSourcesAcrossMove & { text: string }): { text: string; count: number } {
  const noteMoved = pathBefore(across) !== across.path;
  let count = 0;
  let rewritten = '';
  let cursor = 0;
  for (const { src, start, end } of imageDestinations(text)) {
    const image = placesNow(src, across).find((place) => across.exists(place.now));
    if (image === undefined || !(noteMoved || image.moved)) continue;
    if (imageSourceCandidates({ src, notePath: across.path })[0] === image.now) continue;
    const anchor = src.includes('#') ? src.slice(src.indexOf('#')) : '';
    const written = relativeImageSource({ notePath: across.path, imagePath: image.now });
    rewritten += text.slice(cursor, start) + written + anchor;
    cursor = end;
    count += 1;
  }
  return { text: rewritten + text.slice(cursor), count };
}
