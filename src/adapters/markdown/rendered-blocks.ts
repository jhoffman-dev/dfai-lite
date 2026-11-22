import { blockIdOf, type EditorNode, type ParsedBody } from '../../domain/markdown/index.ts';
import { expressedAttrs } from './reading.ts';

/**
 * A block's tree as text, keeping only what the writer reads: types, text,
 * marks in order, and the attributes markdown can say (`expressedAttrs`).
 * The editor gives every node every attribute it knows — a link's target,
 * a cell's span — and the reader gives only what the file says; neither
 * changes how a block is written. Two blocks with the same canonical text
 * are written the same.
 */
function canonical(node: EditorNode): string {
  const marks = (node.marks ?? []).map((mark) => [
    mark.type,
    expressedAttrs(mark.type, mark.attrs),
  ]);
  return JSON.stringify([
    node.type,
    expressedAttrs(node.type, node.attrs),
    marks,
    node.text ?? null,
    (node.content ?? []).map(canonical),
  ]);
}

interface RenderCache {
  /** Each block of the reading, canonically, by its id; made on the first save. */
  readonly readById: Map<string, { readonly canonical: string; readonly normalized: string }>;
  /** Blocks rendered since, by their canonical text. */
  readonly rendered: Map<string, string>;
}

/** Past this many rendered blocks beyond the note's own, the cache starts again. */
const SPARE_ENTRIES = 2000;

const caches = new WeakMap<ParsedBody, RenderCache>();

function cacheOf(parsed: ParsedBody): RenderCache {
  let cache = caches.get(parsed);
  if (cache === undefined) {
    const readById = new Map<string, { canonical: string; normalized: string }>();
    const blocks = new Map(parsed.blocks.map((block) => [block.id, block]));
    for (const node of parsed.doc.content) {
      const block = blocks.get(blockIdOf(node) ?? '');
      if (block !== undefined) {
        readById.set(block.id, { canonical: canonical(node), normalized: block.normalized });
      }
    }
    cache = { readById, rendered: new Map() };
    caches.set(parsed, cache);
  }
  return cache;
}

/**
 * Renders blocks as `render` does, for saves of one reading of a note,
 * without rendering again what it already knows: a block that is still the
 * block it was read as is what it was read as (`normalized`), and one
 * rendered by an earlier save — typing in a long note leaves all but one
 * block as they were — is what it rendered to then. Rendering a block is
 * most of what a save costs; this makes a save of a long note cost about
 * one block's rendering.
 */
export function blockRenderer(
  parsed: ParsedBody,
  render: (node: EditorNode) => string,
): (node: EditorNode) => string {
  const { readById, rendered } = cacheOf(parsed);
  return (node) => {
    const key = canonical(node);
    const read = readById.get(blockIdOf(node) ?? '');
    if (read !== undefined && read.canonical === key) return read.normalized;
    let written = rendered.get(key);
    if (written === undefined) {
      written = render(node);
      if (rendered.size > readById.size + SPARE_ENTRIES) rendered.clear();
      rendered.set(key, written);
    }
    return written;
  };
}
