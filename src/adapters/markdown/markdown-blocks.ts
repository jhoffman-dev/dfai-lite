import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import {
  BLOCK_ID_ATTR,
  blockIdOf,
  type EditorDocument,
  type EditorNode,
  type ParsedBody,
  type SourceBlock,
} from '../../domain/markdown/index.ts';
import type { Nodes, Root, RootContent } from 'mdast';
import './mdast-custom-nodes.ts';
import { mdastBlockToEditorNode } from './mdast-to-editor.ts';
import { editorNodeToMdastBlock } from './editor-to-mdast.ts';
import { escapesATag } from './escaped-tags.ts';
import { writeAsTyped, type ReadMarkdown } from './as-typed.ts';
import { readingOf } from './reading.ts';
import { blockRenderer } from './rendered-blocks.ts';
import { remarkWikiLink } from './wiki-link-syntax.ts';
import { expressible } from './expressible.ts';
import {
  DEFAULT_MARKERS,
  GFM_WRITE_OPTIONS,
  stringifySettings,
  wholeCharacterReferences,
  type ListMarkers,
} from './stringify-settings.ts';
import { keepReferences, referencesIn, type WrittenReferences } from './written-references.ts';

/** A block whose markdown the editor does not model. Shown as source, saved verbatim. */
export const RAW_BLOCK = 'rawBlock';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkWikiLink);

const stringifiers = new Map<string, ReturnType<typeof stringifierWith>>();

function stringifierFor(markers: ListMarkers) {
  const key = `${markers.bullet}${markers.ordered}`;
  let stringifier = stringifiers.get(key);
  if (stringifier === undefined) {
    stringifier = stringifierWith(markers);
    stringifiers.set(key, stringifier);
  }
  return stringifier;
}

const stringifierWith = (markers: ListMarkers) =>
  unified()
    // Cells are not padded out to a common width: a one-character edit would
    // otherwise reflow every row of the table.
    .use(remarkGfm, GFM_WRITE_OPTIONS)
    .use(remarkStringify, stringifySettings(markers));

const render = (root: Root, markers: ListMarkers = DEFAULT_MARKERS): string =>
  wholeCharacterReferences(stringifierFor(markers).stringify(root).replace(/\n+$/, ''));

/** A block as remark writes it, every escape in place, with `written` images as their bytes. */
function renderSafely(
  node: EditorNode,
  written: readonly WrittenInline[] = [],
  markers: ListMarkers = DEFAULT_MARKERS,
): string {
  if (node.type === RAW_BLOCK) return String(node.attrs?.['markdown'] ?? '');
  const root = mdastOf(node);
  keepWrittenInlines(
    root,
    written.filter((inline) => inline.kind === 'image'),
  );
  return render(root, markers);
}

const mdastOf = (node: EditorNode): Root => ({
  type: 'root',
  children: [editorNodeToMdastBlock(node) as never],
});

/** What else decides how a block is written, besides the editor's node. */
interface BlockContext {
  /** How the block was written before it was edited, if it was (`writtenIn`). */
  readonly written?: Written;
  /** The note's link definitions, which decide whether `[x]` in text needs escaping. */
  readonly definitions?: readonly LinkDefinition[];
  /** The markers a list is written with, set by the blocks beside it. */
  readonly markers?: ListMarkers;
}

/**
 * Serializes one block to markdown, without a trailing newline, as close to
 * what was typed as reads the same (A21-01). An image or a link that reads the
 * same as one the block was written with is put back as those bytes, rather
 * than in remark's equivalent form (ADR-0003), and so is a reference such as
 * `&amp;` (A21-03).
 */
export function renderBlock(
  node: EditorNode,
  { written = NOTHING_WRITTEN, definitions = [], markers = DEFAULT_MARKERS }: BlockContext = {},
): string {
  const safe = renderSafely(node, written.inlines, markers);
  if (node.type === RAW_BLOCK) return safe;
  const root = mdastOf(node);
  keepWrittenInlines(root, [...written.inlines]);
  keepReferences(root, written.references);
  writeTypedAddressesBare(root);
  return writeAsTyped({
    safe,
    typed: render(root, markers),
    document: readingOf([expressible(node)]),
    read: (markdown) => readBlock(markdown, definitions),
  });
}

/**
 * Parses a block's markdown with the definitions it could refer to after it,
 * so that `[x]` reads as it would in the note.
 */
function readBlock(markdown: string, definitions: readonly LinkDefinition[]): ReadMarkdown {
  const referred = definitions.filter((definition) => mayReferTo(markdown, definition));
  const body = [markdown, ...referred.map((definition) => definition.markdown)].join('\n\n');
  const root = parseBodyToMdast(body);
  const own = root.children.filter(
    (child) => (child.position?.start.offset ?? 0) < markdown.length,
  );
  return { root, reading: readingOf(own.map((child) => editorNodeFor(child, body))) };
}

/** A link or footnote definition in the note: its label, and its own markdown. */
export interface LinkDefinition {
  readonly label: string;
  readonly markdown: string;
}

/**
 * Whether `markdown` could hold a reference to `definition`. Labels match
 * without regard to case or runs of whitespace; one that lower-casing may not
 * fold (anything beyond ASCII) is always taken to match.
 */
function mayReferTo(markdown: string, { label }: LinkDefinition): boolean {
  // eslint-disable-next-line no-control-regex -- every character outside ASCII
  if (/[^\x00-\x7f]/.test(label)) return true;
  const folded = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
  return folded(markdown).includes(folded(label));
}

/**
 * The note's link and footnote definitions, parsed once. The editor never
 * holds one, so each is in one of its raw blocks.
 */
function definitionsIn(nodes: readonly EditorNode[]): LinkDefinition[] {
  const body = nodes
    .filter((node) => node.type === RAW_BLOCK)
    .map((node) => String(node.attrs?.['markdown'] ?? ''))
    .filter((markdown) => markdown.includes(']:'))
    .join('\n\n');
  if (body === '') return [];
  const found: LinkDefinition[] = [];
  const visit = (node: Nodes) => {
    if (node.type === 'definition' || node.type === 'footnoteDefinition') {
      const start = node.position?.start.offset ?? 0;
      const end = node.position?.end.offset ?? body.length;
      found.push({ label: node.label ?? node.identifier, markdown: body.slice(start, end) });
    } else if ('children' in node) (node.children as Nodes[]).forEach(visit);
  };
  visit(parseBodyToMdast(body));
  return found;
}

/**
 * Writes each link whose text is its own address — `julie@example.com` for
 * `mailto:julie@example.com` — as that bare text, where GFM reads it back as
 * the same link. Whether it does is for `writeAsTyped` to check.
 */
function writeTypedAddressesBare(node: Nodes, inCell = false): void {
  if (!('children' in node)) return;
  const children = node.children as Nodes[];
  children.forEach((child, index) => {
    if (child.type !== 'link') {
      writeTypedAddressesBare(child, inCell || child.type === 'tableCell');
      return;
    }
    const [only] = child.children;
    const text = child.children.length === 1 && only?.type === 'text' ? only.value : '';
    if (text !== '' && !child.title && child.url.endsWith(text))
      children[index] = {
        type: 'verbatimInline',
        value: inCell && text.includes('|') ? escapedForCell(text) : text,
      };
  });
}

/**
 * An address with a `|` in it, as a table cell can hold it (A21-03). The `|`
 * must be escaped or it ends the cell, but GFM finds an address typed bare
 * before escapes are read and runs it on over the backslash: `http://a.b\\|c`
 * links to `http://a.b\\|c`. So the address is not left for that to find — its
 * `://` and `www.` are escaped too — and GFM finds it afterwards instead, in
 * the cell's text, `|` and all, as it did when the note was read.
 */
const escapedForCell = (address: string): string =>
  address
    .replace(/\|/g, '\\|')
    .replace(/:\/\//, '\\://')
    .replace(/^(www)\./i, '$1\\.');

/** An image or link as a block wrote it: what it reads as, and the bytes it was written with. */
interface WrittenInline {
  readonly kind: 'image' | 'link';
  readonly reads: string;
  readonly source: string;
}

/**
 * What an image or a link reads as. A link reads as it would be written
 * afresh, which covers its address, title and text alike.
 */
function inlineReading(node: Nodes): string | null {
  if (node.type === 'image')
    return JSON.stringify([node.url, node.alt ?? null, node.title ?? null]);
  if (node.type !== 'link') return null;
  return render({ type: 'root', children: [{ type: 'paragraph', children: [node] }] });
}

/** How a block was written before it was edited: what of it to write the same way again. */
interface Written {
  readonly inlines: readonly WrittenInline[];
  readonly references: WrittenReferences;
}

const NOTHING_WRITTEN: Written = { inlines: [], references: new Map() };

/** How `source` wrote `block`, from one parse of it. */
function writtenIn(source: string, block: EditorNode): Written {
  const root = parser.parse(source) as Root;
  return { inlines: writtenInlines(root, source, block), references: referencesIn(root, source) };
}

/**
 * Every image and link in a block's markdown, in order, with its own bytes.
 * One that runs over a line break is left out when the block is a container:
 * its bytes carry the container's markers (`> `, an indent), which spliced
 * into the rewritten block would be read again as markup.
 */
function writtenInlines(root: Root, source: string, block: EditorNode): WrittenInline[] {
  const multiLineFits = block.type === 'paragraph';
  const found: WrittenInline[] = [];
  const visit = (node: Nodes) => {
    const reads = inlineReading(node);
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (reads !== null && start !== undefined && end !== undefined) {
      const bytes = source.slice(start, end);
      if (multiLineFits || !bytes.includes('\n'))
        found.push({ kind: node.type === 'image' ? 'image' : 'link', reads, source: bytes });
    }
    if ('children' in node) for (const child of node.children as Nodes[]) visit(child);
  };
  visit(root);
  return found;
}

/**
 * Swaps each image or link in `node` that reads the same as one still in
 * `written` for that one's bytes, using each at most once. One whose address,
 * text or title was changed matches none, and is written afresh.
 */
function keepWrittenInlines(node: Nodes, written: WrittenInline[]): void {
  if (!('children' in node) || written.length === 0) return;
  const children = node.children as Nodes[];
  children.forEach((child, index) => {
    const reads = inlineReading(child);
    const at = reads === null ? -1 : written.findIndex((inline) => inline.reads === reads);
    if (at >= 0) {
      const [inline] = written.splice(at, 1);
      children[index] = { type: 'verbatimInline', value: inline!.source };
      return;
    }
    keepWrittenInlines(child, written);
  });
}

/**
 * Splits a note body into top-level blocks, remembering exactly where each came
 * from. The source ranges are what later allow an untouched block to be written
 * back byte for byte.
 */
/** The markdown syntax tree for a note body, shared by the block parser and search. */
export function parseBodyToMdast(body: string): Root {
  if (!body.startsWith(BYTE_ORDER_MARK)) return parser.parse(body) as Root;
  // The parser drops a leading byte-order mark and counts offsets without it;
  // every offset here is into `body`, the mark included (A21-04).
  const root = parser.parse(body.slice(BYTE_ORDER_MARK.length)) as Root;
  shiftOffsets(root, BYTE_ORDER_MARK.length);
  return root;
}

const BYTE_ORDER_MARK = '﻿';

function shiftOffsets(node: Nodes, by: number): void {
  const { position } = node;
  if (position?.start.offset !== undefined) position.start.offset += by;
  if (position?.end.offset !== undefined) position.end.offset += by;
  if ('children' in node) for (const child of node.children as Nodes[]) shiftOffsets(child, by);
}

export function parseMarkdownBody(body: string): ParsedBody {
  const blocks: SourceBlock[] = [];
  const nodes: EditorNode[] = [];

  readBlocks(parseBodyToMdast(body), body).forEach(({ start, end, node }, index) => {
    const id = `b${index}`;
    // Only compared with the block as it is saved, to tell whether it changed:
    // remark's own rendering does that without a parse, so reading a note costs one.
    blocks.push({
      id,
      index,
      source: body.slice(start, end),
      start,
      end,
      normalized: renderSafely(node),
    });
    nodes.push({ ...node, attrs: { ...node.attrs, [BLOCK_ID_ATTR]: id } });
  });

  return { blocks, doc: { type: 'doc', content: nodes } };
}

/** A top-level block as read: where it is in the body, and the editor's node for it. */
interface ReadBlock {
  readonly child: RootContent;
  readonly start: number;
  readonly end: number;
  readonly node: EditorNode;
}

/** The body's top-level blocks. */
function readBlocks(root: Root, body: string): ReadBlock[] {
  return root.children.map((child) => ({
    child,
    start: child.position?.start.offset ?? 0,
    end: child.position?.end.offset ?? body.length,
    node: editorNodeFor(child, body),
  }));
}

/** A top-level block as the editor holds it, or as its source when the editor cannot. */
function editorNodeFor(child: RootContent, body: string): EditorNode {
  const converted = escapesATag(child, body) ? null : mdastBlockToEditorNode(child, body);
  if (converted !== null) return converted;
  const start = child.position?.start.offset ?? 0;
  const end = child.position?.end.offset ?? body.length;
  return { type: RAW_BLOCK, attrs: { markdown: body.slice(start, end) } };
}

/**
 * Writes the document back to markdown, reusing the original bytes of every block
 * the user did not change — including the whitespace between them. A block counts
 * as unchanged when it serializes to what it serialized to when it was loaded, so
 * editing one paragraph rewrites one paragraph and nothing else.
 */
export function serializeMarkdownBody({
  originalBody,
  parsed,
  doc,
}: {
  originalBody: string;
  parsed: ParsedBody;
  doc: EditorDocument;
}): string {
  const byId = new Map(parsed.blocks.map((block) => [block.id, block]));
  const rendered = blockRenderer(parsed, (node) => renderSafely(node));
  // The editor keeps an empty paragraph at the end so there is somewhere to type
  // after an atom block. Markdown has no such thing, so blocks that serialize to
  // nothing are dropped rather than written out as stray blank lines. Only
  // markdown's own whitespace counts as nothing: a no-break space is what an
  // `&nbsp;` spacer paragraph holds, and it is kept (A21-04).
  const nodes = doc.content.filter((node) => /[^ \t\r\n]/.test(rendered(node)));

  if (nodes.length === 0) return parsed.blocks.length === 0 ? originalBody : '';

  const pieces: string[] = [];
  let previous: SourceBlock | null = null;
  let previousText = '';
  // The definitions the saved note will hold: parsed once, and only once a block has changed.
  let definitions: readonly LinkDefinition[] | undefined;
  const definitionsOfNote = () => (definitions ??= definitionsIn(nodes));
  const lineEnding = lineEndingOf(originalBody);
  // Each block's own bytes where it was not changed.
  const kept = nodes.map((node) => {
    const block = byId.get(blockIdOf(node) ?? '') ?? null;
    return block !== null && rendered(node) === block.normalized ? block.source : null;
  });

  nodes.forEach((node, index) => {
    const block = byId.get(blockIdOf(node) ?? '') ?? null;
    const keptText = kept[index] ?? null;
    // A kept list that now stands after another with its markers is written again
    // with other ones, or the two read back as one list (`listsWouldJoin`).
    const joinsBefore = keptText !== null && listsWouldJoin(previousText, keptText);
    const unchanged = keptText !== null && !joinsBefore;
    const next = kept[index + 1] ?? '';
    // The list that joins is re-marked in its own bytes where they read back as
    // it (ADR-0003, addendum), and written afresh only where they do not.
    const remarked =
      keptText !== null && joinsBefore
        ? withMarkersChanged(node, keptText, markersBeside(previousText, next))
        : null;
    const text = unchanged
      ? keptText
      : (remarked ??
        withLineEnding(
          renderBlock(node, {
            written: block === null ? NOTHING_WRITTEN : writtenIn(block.source, node),
            definitions: definitionsOfNote(),
            markers: markersBeside(previousText, next),
          }),
          lineEnding,
        ));

    if (index === 0) {
      // Whatever precedes the first block — the blank line after frontmatter, say —
      // belongs to the document rather than to the block, so it is kept even when
      // that first block is the one being edited.
      pieces.push(originalBody.slice(0, parsed.blocks[0]?.start ?? 0));
    } else {
      const original = separatorBetween({ originalBody, previous, block, unchanged });
      pieces.push(original ?? `${lineEnding}${lineEnding}`);
    }

    pieces.push(text);
    // A re-marked list still stands in its own bytes, so the whitespace that
    // followed it in the file is still its own to keep.
    previous = unchanged || remarked !== null ? block : null;
    previousText = text;
  });

  pieces.push(trailing({ originalBody, parsed, previous, nodes }) ?? lineEnding);
  return pieces.join('');
}

/**
 * The line ending the note is written with: its first one, so a file saved
 * on Windows keeps its `\r\n` in the blocks that are rewritten (A21-03).
 */
function lineEndingOf(body: string): '\n' | '\r\n' {
  const first = body.indexOf('\n');
  return first > 0 && body[first - 1] === '\r' ? '\r\n' : '\n';
}

/** `text`, written by remark with `\n`, with the note's own line ending instead. */
const withLineEnding = (text: string, lineEnding: string): string =>
  lineEnding === '\n' ? text : text.replace(/\r?\n/g, lineEnding);

const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

type ListMarker = ListMarkers['bullet'] | ListMarkers['ordered'];

/** The marker a block's first line makes it an item with — a bullet, or a number's delimiter — or null. */
function listMarkerOf(text: string): ListMarker | null {
  const line = text.split(/\r?\n/, 1)[0] ?? '';
  // `- - -` and `* * *` are separators, not lists (A21-04).
  if (THEMATIC_BREAK.test(line)) return null;
  const match = /^ {0,3}(?:\d{1,9}([.)])|([-*+]))(?:[ \t]|$)/.exec(line);
  return match === null ? null : ((match[2] ?? match[1]) as ListMarker);
}

/**
 * Whether `after`, written straight after `before`, would read as more of the
 * same list: both begin as items with one marker. Two kept lists come to
 * stand so when the block between them is moved or deleted (#569); the one
 * after is then written again with the markers the one before does not use,
 * so the note reads back as the two lists the person sees.
 */
const listsWouldJoin = (before: string, after: string): boolean => {
  const marker = listMarkerOf(before);
  return marker !== null && marker === listMarkerOf(after);
};

/** The list markers neither neighbor's first line is written with (`ListMarkers`). */
function markersBeside(before: string, after: string): ListMarkers {
  const beside = [listMarkerOf(before), listMarkerOf(after)];
  // Every marker of a kind beside it (three numbered lists in a row): the one before
  // is written already, so its marker is the one to avoid; the one after is written
  // again in its turn if it then joins.
  const free = <Marker extends ListMarker>(all: readonly Marker[]): Marker =>
    all.find((marker) => !beside.includes(marker)) ?? all.find((marker) => marker !== beside[0])!;
  return { bullet: free(['-', '*', '+']), ordered: free(['.', ')']) };
}

/**
 * A kept list's bytes with only its marker characters changed to `markers`:
 * the bullet, or the number's delimiter, of every item at the list's own
 * level — a nested list keeps its own — and every other byte as it was, its
 * escapes and spacing among them (ADR-0003, addendum). Null when the
 * re-marked bytes do not read back as the list `node` is (`- * * *` made
 * `* * * *` is a rule), which is then written afresh instead.
 */
function withMarkersChanged(node: EditorNode, text: string, markers: ListMarkers): string | null {
  const [read, ...more] = readBlocks(parseBodyToMdast(text), text);
  if (read === undefined || more.length > 0 || read.child.type !== 'list') return null;
  const marker = read.child.ordered === true ? markers.ordered : markers.bullet;
  const pieces: string[] = [];
  let at = 0;
  for (const item of read.child.children) {
    const start = item.position?.start.offset;
    if (start === undefined) return null;
    const digits = /^\d{0,9}/.exec(text.slice(start, start + 9))?.[0] ?? '';
    const markerAt = start + digits.length;
    if (!/^[-*+.)]$/.test(text.charAt(markerAt))) return null;
    pieces.push(text.slice(at, markerAt), marker);
    at = markerAt + 1;
  }
  pieces.push(text.slice(at));
  const remarked = pieces.join('');
  return readsAsBlock(remarked, node) ? remarked : null;
}

/** Whether `text` reads back as the one block `node` is. */
function readsAsBlock(text: string, node: EditorNode): boolean {
  const [read, ...more] = readBlocks(parseBodyToMdast(text), text);
  return read !== undefined && more.length === 0 && renderSafely(read.node) === renderSafely(node);
}

function separatorBetween({
  originalBody,
  previous,
  block,
  unchanged,
}: {
  originalBody: string;
  previous: SourceBlock | null;
  block: SourceBlock | null;
  unchanged: boolean;
}): string | null {
  // Null: a blank line, written with the note's own line ending.
  // The original whitespace may only be reused when these two blocks were
  // neighbors in the original too. Checking offsets alone would splice back in
  // whatever sat between them — including a block the user just deleted.
  const stillAdjacent = previous !== null && block !== null && block.index === previous.index + 1;
  if (stillAdjacent && unchanged) {
    return originalBody.slice(previous.end, block.start);
  }
  return null;
}

function trailing({
  originalBody,
  parsed,
  previous,
  nodes,
}: {
  originalBody: string;
  parsed: ParsedBody;
  previous: SourceBlock | null;
  nodes: readonly EditorNode[];
}): string | null {
  const lastOriginal = parsed.blocks.at(-1);
  const keptTheEnding =
    previous !== null && lastOriginal !== undefined && previous.id === lastOriginal.id;
  if (keptTheEnding) return originalBody.slice(lastOriginal.end);
  // A note ends with exactly one line ending (null) unless its original ending was preserved.
  return nodes.length === 0 ? '' : null;
}
