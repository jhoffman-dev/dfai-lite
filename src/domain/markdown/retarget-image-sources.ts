import { relativeImageSource, vaultImageSource } from '../attachments/image-placement.ts';
import { foldedPath, isWithin, type PathMove, type VaultPath } from '../vault/note-path.ts';
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
// A reference image: `![alt][label]`, `![label][]` or `![label]`, not followed by `(`.
const REFERENCE_IMAGE = /!\[((?:\\.|[^\\\]\n])*)\](?:\[((?:\\.|[^\\\]\n])*)\]|(?![[(]))/g;
// A link reference definition: `[label]: destination`, at most three spaces in.
const DEFINITION = /^ {0,3}\[((?:\\.|[^\\\]\n])+)\]:[ \t]*(<(?:\\.|[^\\<>\n])*>|\S+)/gm;
const EXTERNAL = /^(https?:|data:)/i;

// A fenced block, from its opening fence to the matching close (or the end),
// and an inline code span: an image source inside either is text.
const CODE =
  /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[`~]*[ \t]*$|(?![\s\S]))|(`+)[^`\n][\s\S]*?\3/gm;

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const indentOf = (line: string) => /^[ \t]*/.exec(line)?.[0].replace(/\t/g, '    ').length ?? 0;

/**
 * The indented code blocks of `text`, as ranges: lines four spaces in after a
 * blank line, outside a list (where such a line goes on the item). Read on
 * the safe side: anything that may be code is left alone.
 */
function indentedCode(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let at = 0;
  let afterBlank = true;
  let inCode = false;
  let inList = false;
  for (const line of text.split('\n')) {
    const blank = line.trim() === '';
    if (!blank && indentOf(line) < 4) {
      inCode = false;
      inList = LIST_ITEM.test(line) || (inList && !afterBlank);
    } else if (!blank && (inCode || (afterBlank && !inList))) {
      inCode = true;
      ranges.push({ start: at, end: at + line.length });
    }
    afterBlank = blank;
    at += line.length + 1;
  }
  return ranges;
}

/** Whether an offset in `text` falls in code: fenced, indented, or a span. */
function codeRanges(text: string): (at: number) => boolean {
  const code = [
    ...[...text.matchAll(CODE)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    })),
    ...indentedCode(text),
  ];
  return (at) => code.some((range) => at >= range.start && at < range.end);
}

interface Destination {
  readonly src: string;
  readonly start: number;
  readonly end: number;
}

/** A destination as written, `<…>` or bare, as the file name it is. */
function destinationOf(written: string, start: number): Destination | null {
  const bare = written.startsWith('<') ? written.slice(1, -1) : written;
  const src = bare.replace(/\\([!-/:-@[-`{-~])/g, '$1');
  if (src.trim() === '' || EXTERNAL.test(src.trim())) return null;
  return { src, start, end: start + written.length };
}

/** Every `![…](src)` in `text` outside code: the source as it names a file, and where its bytes are. */
function inlineDestinations(text: string, inCode: (at: number) => boolean): Destination[] {
  return [...text.matchAll(IMAGE)].flatMap((match) => {
    const written = match[1] ?? '';
    if (inCode(match.index)) return [];
    return destinationOf(written, match.index + match[0].length - written.length) ?? [];
  });
}

/** A label as CommonMark matches it: case and runs of space aside. */
const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();

/** The destinations of the definitions an image in `text` uses (`![a][r]`, `[r]: x.png`). */
function referenceDestinations(text: string, inCode: (at: number) => boolean): Destination[] {
  const used = new Set(
    [...text.matchAll(REFERENCE_IMAGE)]
      .filter((match) => !inCode(match.index))
      .map((match) => labelKey(match[2] === undefined || match[2] === '' ? match[1]! : match[2])),
  );
  return [...text.matchAll(DEFINITION)].flatMap((match) => {
    const written = match[2] ?? '';
    if (inCode(match.index) || !used.has(labelKey(match[1] ?? ''))) return [];
    return destinationOf(written, match.index + match[0].length - written.length) ?? [];
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

/**
 * Where `path` is after the move, or null when the move leaves it be; case
 * aside, as the Mac's disk moves a folder: `attachments/x.png` goes with `Attachments`.
 */
function pathAfterMove(path: VaultPath, { from, to }: PathMove): VaultPath | null {
  const [folded, moved] = [foldedPath(path), foldedPath(from)];
  if (folded === moved) return to;
  return folded.startsWith(`${moved}/`) ? `${to}${path.slice(from.length)}` : null;
}

/** Whether two paths name the same file on a Mac's disk. */
const sameFile = (left: VaultPath | undefined, right: VaultPath) =>
  left !== undefined && foldedPath(left) === foldedPath(right);

/** The file `src`, in the note at `notePath`, resolves to among those that exist. */
const resolvedFrom = (src: string, notePath: VaultPath, exists: (path: VaultPath) => boolean) =>
  imageSourceCandidates({ src, notePath }).find(exists);

/** Whether `path`, as it was before the move, is in the vault: followed to where it is now. */
const existedBefore = (path: VaultPath, across: ImageSourcesAcrossMove) =>
  across.exists(pathAfterMove(path, across.move) ?? path);

/** Where the file `src` resolved to before the move is now; none when it resolved to none. */
function imageNow(src: string, across: ImageSourcesAcrossMove): VaultPath | undefined {
  const then = imageSourceCandidates({ src, notePath: pathBefore(across) }).find((candidate) =>
    existedBefore(candidate, across),
  );
  return then === undefined ? undefined : (pathAfterMove(then, across.move) ?? then);
}

/** Whether `src` was read from the vault root rather than from the note's folder. */
function readFromRoot(src: string, across: ImageSourcesAcrossMove): boolean {
  if (src.startsWith('/')) return true;
  const [besideNote, fromRoot] = imageSourceCandidates({ src, notePath: pathBefore(across) });
  return fromRoot !== undefined && (besideNote === undefined || !existedBefore(besideNote, across));
}

/**
 * `src` rewritten to reach `image` from the note at `path`, in the style it
 * was written in: from the vault root (with its `/` if it had one) when it
 * was read from there, else relative to the note.
 */
function rewritten(src: string, image: VaultPath, across: ImageSourcesAcrossMove): string {
  const relative = relativeImageSource({ notePath: across.path, imagePath: image });
  if (!readFromRoot(src, across)) return relative;
  const vault = `${src.startsWith('/') ? '/' : ''}${vaultImageSource(image)}`;
  // A file of the same name beside the note would answer first: then it goes relative.
  return sameFile(resolvedFrom(vault, across.path, across.exists), image) ? vault : relative;
}

/**
 * Re-points every image source a move would break, as DFAI does: in a moved
 * note, or reaching into a moved folder; inline images and the reference
 * definitions images use. A source changes only when, left as it is, it
 * would stop resolving to the file it resolved to before the move — one read
 * from the vault root, Obsidian's way, that still resolves is left alone —
 * and is then rewritten in the style it was written in. Only the
 * destination's bytes change. Code (fenced, indented, a span) is text and is
 * never touched, nor is an HTML `<img>`, nor a source that resolved to
 * nothing: rewriting those would be a guess.
 */
export function retargetImageSources({
  text,
  ...across
}: ImageSourcesAcrossMove & { text: string }): { text: string; count: number } {
  const inCode = codeRanges(text);
  const destinations = [
    ...inlineDestinations(text, inCode),
    ...referenceDestinations(text, inCode),
  ];
  destinations.sort((left, right) => left.start - right.start);
  let count = 0;
  let out = '';
  let cursor = 0;
  for (const { src, start, end } of destinations) {
    const image = imageNow(src, across);
    if (image === undefined || sameFile(resolvedFrom(src, across.path, across.exists), image))
      continue;
    const anchor = src.includes('#') ? src.slice(src.indexOf('#')) : '';
    out += text.slice(cursor, start) + rewritten(src, image, across) + anchor;
    cursor = end;
    count += 1;
  }
  return { text: out + text.slice(cursor), count };
}
