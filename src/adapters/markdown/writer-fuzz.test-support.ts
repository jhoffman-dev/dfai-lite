import type { EditorDocument, EditorMark, EditorNode } from '../../domain/markdown/index.ts';

/**
 * Seeded editor documents for the writer's property test (A21-03), and the
 * comparison it makes. Kept apart from the test so a failing seed can be
 * replayed and bucketed on its own.
 */

/** Seeded, so every failing case can be replayed by its seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export const PIECES = [
  '*',
  '**',
  '_',
  '__',
  '~',
  '~~',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '&',
  '#',
  '\\',
  '`',
  '|',
  '!',
  '@',
  ':',
  '=',
  '-',
  '+',
  '.',
  '1.',
  '"',
  "'",
  '{',
  '}',
  '^',
  '$',
  '%%',
  ' ',
  ' ',
  ' ',
  '  ',
  '\t',
  'a',
  'k',
  'word',
  'snake_case',
  'www.',
  'www.x.com',
  'http://',
  'http://a.b',
  'a@b.co',
  '&amp;',
  '&copy;',
  '&#35;',
  '&#x20;',
  '&nbsp',
  '[^1]',
  '<b>',
  '</b>',
  '<!-- c -->',
  '[[',
  ']]',
  '[[x]]',
  '\\[\\[x]]',
  '#x',
  '#x y#',
  '[x]',
  '[x](y)',
  '![x](y)',
  'é',
  '😀',
  ' ',
];

export const TARGETS = [
  'Note',
  '_draft_',
  'a*b*c',
  'a<b>',
  'x `y` z',
  '~~s~~',
  'a&amp;b',
  'k\\k',
  'a b',
];
export const HREFS = [
  'https://example.com',
  'https://e.com/a_b_',
  'mailto:a@b.co',
  'x y',
  '<x>',
  '#h',
];
export const SRCS = ['pic.png', 'a b.png', 'x)y.png', 'https://e.com/i.png'];

type Random = () => number;

class Generator {
  private readonly random: Random;

  constructor(random: Random) {
    this.random = random;
  }

  private pick<T>(options: readonly T[]): T {
    return options[Math.floor(this.random() * options.length)]!;
  }

  private chance(p: number): boolean {
    return this.random() < p;
  }

  private words(): string {
    return Array.from({ length: 1 + Math.floor(this.random() * 5) }, () => this.pick(PIECES)).join(
      '',
    );
  }

  private marks(): EditorMark[] {
    if (this.chance(0.1)) return [{ type: 'code' }];
    const marks: EditorMark[] = (['bold', 'italic', 'strike'] as const)
      .filter(() => this.chance(0.2))
      .map((type) => ({ type }));
    if (this.chance(0.08))
      marks.push({ type: 'link', attrs: { href: this.pick(HREFS), title: null } });
    return marks;
  }

  private withMarks(node: EditorNode, marks: EditorMark[]): EditorNode {
    return marks.length === 0 ? node : { ...node, marks };
  }

  private inlineAtom(): EditorNode {
    const kind = this.pick(['wikiLink', 'wikiLink', 'image', 'hardBreak']);
    if (kind === 'hardBreak') return { type: 'hardBreak' };
    if (kind === 'image')
      return {
        type: 'image',
        attrs: {
          src: this.pick(SRCS),
          alt: this.chance(0.5) ? this.words() : null,
          title: null,
        },
      };
    const embed = this.chance(0.2);
    return this.withMarks(
      {
        type: 'wikiLink',
        attrs: {
          target: this.pick(TARGETS),
          heading: this.chance(0.2) ? '#Part' : null,
          alias: this.chance(0.2) ? 'shown' : null,
          ...(embed ? { embed: true } : {}),
        },
      },
      this.marks().filter((mark) => mark.type !== 'code'),
    );
  }

  /** A run of inline content: text of every kind, with marks, and inline atoms between. */
  inline(): EditorNode[] {
    const count = 1 + Math.floor(this.random() * 4);
    return Array.from({ length: count }, () =>
      this.chance(0.15)
        ? this.inlineAtom()
        : this.withMarks({ type: 'text', text: this.words() }, this.marks()),
    );
  }

  paragraph(): EditorNode {
    return { type: 'paragraph', content: this.inline() };
  }

  private item(type: string, attrs?: Record<string, unknown>): EditorNode {
    const content = [this.paragraph()];
    if (this.chance(0.2)) content.push(this.nested());
    return { type, ...(attrs && { attrs }), content };
  }

  private items(type: string, attrs: () => Record<string, unknown> | undefined): EditorNode[] {
    return Array.from({ length: 1 + Math.floor(this.random() * 2) }, () =>
      this.item(type, attrs()),
    );
  }

  private nested(): EditorNode {
    switch (this.pick(['p', 'ul', 'ol', 'quote'])) {
      case 'ul':
        return { type: 'bulletList', content: this.items('listItem', () => undefined) };
      case 'ol':
        return {
          type: 'orderedList',
          attrs: { start: this.pick([1, 3]) },
          content: this.items('listItem', () => undefined),
        };
      case 'quote':
        return { type: 'blockquote', content: [this.paragraph()] };
      default:
        return this.paragraph();
    }
  }

  private cell(type: string): EditorNode {
    return { type, content: [{ type: 'paragraph', content: this.inline() }] };
  }

  block(): EditorNode {
    switch (this.pick(['p', 'p', 'h', 'ul', 'ol', 'task', 'quote', 'callout', 'table'])) {
      case 'h':
        return {
          type: 'heading',
          attrs: { level: 1 + Math.floor(this.random() * 6) },
          content: this.inline(),
        };
      case 'ul':
        return { type: 'bulletList', content: this.items('listItem', () => undefined) };
      case 'ol':
        return {
          type: 'orderedList',
          attrs: { start: this.pick([1, 3]) },
          content: this.items('listItem', () => undefined),
        };
      case 'task':
        return {
          type: 'taskList',
          content: this.items('taskItem', () => ({ checked: this.chance(0.5) })),
        };
      case 'quote':
        return {
          type: 'blockquote',
          content: [this.paragraph(), ...(this.chance(0.3) ? [this.nested()] : [])],
        };
      case 'callout':
        return {
          type: 'callout',
          attrs: { kind: 'note', title: this.chance(0.3) ? 'Title' : null, fold: null },
          content: [this.paragraph(), ...(this.chance(0.3) ? [this.nested()] : [])],
        };
      case 'table':
        return {
          type: 'table',
          attrs: { align: [null, null] },
          content: ['tableHeader', 'tableCell'].map((cell) => ({
            type: 'tableRow',
            content: [this.cell(cell), this.cell(cell)],
          })),
        };
      default:
        return this.paragraph();
    }
  }
}

export function generatedDocument(seed: number): EditorDocument {
  const generator = new Generator(mulberry32(seed));
  const random = mulberry32(seed ^ 0x9e3779b9);
  const count = 1 + Math.floor(random() * 3);
  return { type: 'doc', content: Array.from({ length: count }, () => generator.block()) };
}

/*
 * What a document is, to the eye and to markdown: the comparison the property
 * makes. Written here, apart from the writer's own check (`reading.ts`), so the
 * writer is not the judge of itself. What markdown cannot say is
 * taken out of both sides alike:
 *
 * - spaces and tabs at either end of a line of a text block (a paragraph, heading
 *   or cell), and a line break that ends one: markdown drops them when read,
 *   so the writer drops them when writing;
 * - bold, italic or strike on whitespace at the edge of its run: `**See **`
 *   is not bold in markdown, so the writer puts the space outside the run;
 * - an image with an empty description and one with none;
 * - a paragraph with nothing in it, outside a table cell;
 * - the link GFM makes of an address typed as plain text: Obsidian shows that
 *   text as a link too.
 */

const TEXT_BLOCKS = new Set(['paragraph', 'heading']);
const EDGE_MARKS = new Set(['bold', 'italic', 'strike']);

const markKey = (mark: EditorMark) =>
  mark.type === 'link'
    ? `link:${String(mark.attrs?.['href'])}:${String(mark.attrs?.['title'] ?? null)}`
    : mark.type;

const marksOf = (node: EditorNode) => (node.marks ?? []).map(markKey).sort().join(',');

function isAutolinkOf(mark: EditorMark, value: string): boolean {
  const href = String(mark.attrs?.['href'] ?? '');
  return (
    mark.type === 'link' &&
    (mark.attrs?.['title'] ?? null) === null &&
    [value, `mailto:${value}`, `http://${value}`].includes(href)
  );
}

/** Adjacent text with the same marks as one node. */
function merged(nodes: readonly EditorNode[]): EditorNode[] {
  const out: EditorNode[] = [];
  for (const node of nodes) {
    const previous = out.at(-1);
    if (previous?.type === 'text' && node.type === 'text' && marksOf(previous) === marksOf(node))
      out[out.length - 1] = { ...previous, text: `${previous.text}${node.text}` };
    else if (node.type !== 'text' || (node.text ?? '') !== '') out.push(node);
  }
  return out;
}

/** Each character as its own text node, so marks can be taken off one at a time. */
const characters = (nodes: readonly EditorNode[]): EditorNode[] =>
  nodes.flatMap((node) =>
    node.type === 'text' ? [...(node.text ?? '')].map((text) => ({ ...node, text })) : [node],
  );

const isCode = (node: EditorNode) => (node.marks ?? []).some((mark) => mark.type === 'code');
const isBlank = (node: EditorNode) =>
  node.type === 'text' && !isCode(node) && /^\s$/u.test(node.text ?? '');
/** Markdown strips spaces and tabs from the ends of a line, but no other space. */
const isLineSpace = (node: EditorNode) =>
  node.type === 'text' && !isCode(node) && /^[ \t]$/.test(node.text ?? '');

/**
 * Whitespace off both ends of every line of a text block — its own ends and
 * either side of a line break — and the line breaks that end it.
 */
function trimmed(nodes: EditorNode[]): EditorNode[] {
  const out: EditorNode[] = [];
  let line: EditorNode[] = [];
  const endLine = () => {
    let start = 0;
    let end = line.length;
    while (start < end && isLineSpace(line[start]!)) start += 1;
    while (end > start && isLineSpace(line[end - 1]!)) end -= 1;
    out.push(...line.slice(start, end));
    line = [];
  };
  for (const node of nodes) {
    if (node.type !== 'hardBreak') {
      line.push(node);
      continue;
    }
    endLine();
    out.push(node);
  }
  endLine();
  while (out.at(-1)?.type === 'hardBreak') out.pop();
  return out;
}

/** Bold, italic and strike taken off whitespace at the edges of their runs. */
function expelled(nodes: EditorNode[]): EditorNode[] {
  const out = nodes.map((node) => ({ ...node }));
  const has = (at: number, key: string) =>
    (out[at]?.marks ?? []).some((mark) => markKey(mark) === key);
  for (const type of EDGE_MARKS) {
    for (let changed = true; changed;) {
      changed = false;
      out.forEach((node, at) => {
        if (!isBlank(node) || !has(at, type)) return;
        if (has(at - 1, type) && has(at + 1, type)) return;
        node.marks = (node.marks ?? []).filter((mark) => mark.type !== type);
        if (node.marks.length === 0) delete node.marks;
        changed = true;
      });
    }
  }
  return out;
}

function unlinked(node: EditorNode): EditorNode {
  if (node.type !== 'text') return node;
  const marks = (node.marks ?? []).filter((mark) => !isAutolinkOf(mark, node.text ?? ''));
  return { type: 'text', text: node.text ?? '', ...(marks.length > 0 && { marks }) };
}

function attrsOf(node: EditorNode): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(node.attrs ?? {})
      .filter(([key, value]) => key !== 'blockId' && value !== null && value !== false)
      .filter(([key, value]) => !(node.type === 'image' && key === 'alt' && value === ''))
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

function normalized(node: EditorNode): unknown {
  if (node.type === 'text') return { text: node.text, marks: marksOf(node) };
  let content = node.content ?? [];
  if (TEXT_BLOCKS.has(node.type)) {
    content = merged(expelled(trimmed(characters(content))));
  }
  content = merged(content).map(unlinked);
  const children = withoutEmptyParagraphs(
    merged(content).map((child) => normalized(child)),
    node.type,
  );
  return { type: node.type, attrs: attrsOf(node), marks: marksOf(node), content: children };
}

const CELLS = new Set(['tableCell', 'tableHeader']);

/**
 * A paragraph with nothing in it, outside a table cell, is nothing: markdown
 * has no way to write one (`-` alone is an empty item, `>` an empty quote).
 */
const withoutEmptyParagraphs = (content: unknown[], parent: string): unknown[] =>
  CELLS.has(parent)
    ? content
    : content.filter((child) => {
        const { type, content: inner } = child as { type?: string; content?: unknown[] };
        return type !== 'paragraph' || (inner?.length ?? 0) > 0;
      });

/** A table cell holds one line: its paragraphs run together, as the writer writes them. */
function cellsAsOneParagraph(node: EditorNode): EditorNode {
  if (node.type === 'tableCell' || node.type === 'tableHeader') {
    const inline = (node.content ?? []).flatMap((block) => block.content ?? []);
    return { type: node.type, content: [{ type: 'paragraph', content: inline }] };
  }
  return node.content === undefined
    ? node
    : { ...node, content: node.content.map(cellsAsOneParagraph) };
}

export const documentOf = (nodes: readonly EditorNode[]) =>
  JSON.stringify(
    withoutEmptyParagraphs(
      nodes.map((node) => normalized(cellsAsOneParagraph(node))),
      'doc',
    ),
  );

/**
 * How many seeds a property runs: `set`, the value of the environment
 * variable `name` that a test read (a nightly run sets the old breadth), or
 * else `fallback`; in runs of `size` as `[first, last]`, so each `it` stays
 * small however many there are.
 */
export function seedRuns({
  name,
  set,
  fallback,
  size,
}: {
  name: string;
  set: string | undefined;
  fallback: number;
  size: number;
}): (readonly [number, number])[] {
  const count = set === undefined || set === '' ? fallback : Number(set);
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`${name} must be a whole number above 0, not ${String(set)}`);
  return Array.from(
    { length: Math.ceil(count / size) },
    (_, run) => [run * size + 1, Math.min((run + 1) * size, count)] as const,
  );
}
