// A small reader for the YAML frontmatter DFAI writes: flat keys with
// scalars (plain, quoted, or `|` / `>` blocks), lists (block or `[a, b]`), and
// lists of flat maps (`attendees`). Anything else is not guessed at: its lines
// come back verbatim in `unconverted`, so the migration can keep and report them.

export type FrontmatterValue =
  | string
  | boolean
  | null
  | readonly string[]
  | readonly Readonly<Record<string, string | boolean>>[];

/** Frontmatter lines the reader did not understand, as written: one key's lines, or one stray line. */
export interface UnconvertedLines {
  /** The key, or the line itself when it has none. */
  readonly label: string;
  readonly lines: readonly string[];
}

export interface Frontmatter {
  /** Keys in the order written. */
  readonly properties: ReadonlyMap<string, FrontmatterValue>;
  /** The note after the closing `---`. */
  readonly body: string;
  /** Everything in the frontmatter that is not in `properties`, verbatim (comment lines included). */
  readonly unconverted: readonly UnconvertedLines[];
  /** Comments: whole lines (also in `unconverted`) and `# …` after a value (dropped). */
  readonly comments: number;
}

const OPEN = /^---\r?\n/;
const CLOSE = /\r?\n---[ \t]*(?:\r?\n|$)/;
/** A key, plain (spaces allowed, as Obsidian writes them) or quoted, then `:` and maybe a value. */
const KEY_LINE =
  /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"\-?:[\]{},][^:]*?)[ \t]*:(?:[ \t]+(.*))?$/;
const ITEM_LINE = /^(\s*)-(?:[ \t]+(.*))?$/;
const MAP_ENTRY = /^([A-Za-z_][\w .-]*?)[ \t]*:(?:[ \t]+(.*))?$/;
const COMMENT_LINE = /^\s*#/;
const BLOCK_SCALAR = /^([|>])[+-]?(\d?)[+-]?[ \t]*(?:#.*)?$/;
/** Values this reader does not take apart: anchors, aliases, tags, maps, nested lists and blocks. */
const UNREAD_START = /^[&*!{%@`]/;
const UNREAD_ITEM_START = /^[&*!{%@`[|>-]/;

/** The note's frontmatter and the body after it; no frontmatter gives an empty map and the whole text. */
export function readFrontmatter(text: string): Frontmatter {
  const none = { properties: new Map(), body: text, unconverted: [], comments: 0 };
  const opened = OPEN.exec(text);
  if (opened === null) return none;
  const rest = text.slice(opened[0].length);
  const closed = CLOSE.exec(`\n${rest}`);
  if (closed === null) return none;
  const lines = rest.slice(0, Math.max(0, closed.index - 1)).split(/\r?\n/);
  // A note may open with a `---` rule: only a block that reads as YAML, with
  // at least one key (a lone `# Heading` reads as a YAML comment), is frontmatter.
  if (!lines.every(isYamlShaped) || !lines.some(isKeyLine)) return none;
  const body = rest.slice(closed.index - 1 + closed[0].length);
  return { ...readProperties(lines), body };
}

const isKeyLine = (line: string): boolean => !COMMENT_LINE.test(line) && KEY_LINE.test(line);

/** Blank, a comment, a `key:` line, a list item, or an indented continuation. */
function isYamlShaped(line: string): boolean {
  return (
    line.trim() === '' ||
    /^\s/.test(line) ||
    COMMENT_LINE.test(line) ||
    ITEM_LINE.test(line) ||
    KEY_LINE.test(line)
  );
}

/** What a read has found so far. */
interface Reading {
  properties: Map<string, FrontmatterValue>;
  unconverted: UnconvertedLines[];
  comments: number;
}

function readProperties(lines: readonly string[]): Omit<Frontmatter, 'body'> {
  const reading: Reading = { properties: new Map(), unconverted: [], comments: 0 };
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] as string;
    at += 1;
    if (line.trim() === '') continue;
    const match = KEY_LINE.exec(line);
    if (match === null || COMMENT_LINE.test(line)) {
      if (COMMENT_LINE.test(line)) reading.comments += 1;
      reading.unconverted.push({ label: line.trim(), lines: [line] });
      continue;
    }
    const [, rawKey = '', inline = ''] = match;
    const block: string[] = [];
    const takesZeroIndentList = inline.trim() === '';
    while (at < lines.length && belongsToBlock(lines[at] as string, takesZeroIndentList)) {
      block.push(lines[at++] as string);
    }
    while (block.length > 0 && (block.at(-1) as string).trim() === '') block.pop();
    const key = keyText(rawKey);
    const value = reading.properties.has(key) ? undefined : entryValue(inline, block, reading);
    if (value === undefined) reading.unconverted.push({ label: key, lines: [line, ...block] });
    else reading.properties.set(key, value);
  }
  return reading;
}

/** Whether a line under a key is part of its value: blank, indented, or a `- item` under an empty key. */
function belongsToBlock(line: string, takesZeroIndentList: boolean): boolean {
  return line.trim() === '' || /^\s/.test(line) || (takesZeroIndentList && ITEM_LINE.test(line));
}

const keyText = (raw: string): string => {
  const value = scalar(raw);
  return typeof value === 'string' ? value : raw.trim();
};

/** A key's value, or undefined when it is not something this reader takes apart. */
function entryValue(
  inline: string,
  block: readonly string[],
  reading: Reading,
): FrontmatterValue | undefined {
  const trimmed = inline.trim();
  const blockScalar = BLOCK_SCALAR.exec(trimmed);
  if (blockScalar !== null) return blockScalarText(blockScalar, block);
  if (trimmed === '') return block.length === 0 ? null : blockValue(block, reading);
  if (UNREAD_START.test(trimmed)) return undefined;
  // A plain or quoted value may run on over indented lines: YAML folds them.
  return scalarOrInlineList(folded([trimmed, ...block.map((line) => line.trim())]), reading);
}

/** A `|` (lines kept) or `>` (lines folded) block, its indentation taken off and its ending trimmed. */
function blockScalarText(header: RegExpExecArray, block: readonly string[]): string {
  const firstText = block.find((line) => line.trim() !== '') ?? '';
  const stated = Number(header[2] ?? '');
  const indent = stated > 0 ? stated : (/^\s*/.exec(firstText)?.[0].length ?? 0);
  const lines = block.map((line) => (line.trim() === '' ? '' : line.slice(indent)));
  const text = header[1] === '|' ? lines.join('\n') : folded(lines);
  return text.replace(/\s+$/, '');
}

/** YAML folding: the lines of a paragraph join with a space; a blank line is a line break. */
function folded(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line === '') {
      paragraphs.push(current.join(' '));
      current = [];
    } else current.push(line);
  }
  paragraphs.push(current.join(' '));
  return paragraphs.join('\n').replace(/^\n+/, '');
}

/** An indented block under a key: a list of scalars or a list of maps; anything else is not read. */
function blockValue(block: readonly string[], reading: Reading): FrontmatterValue | undefined {
  const items = blockItems(block);
  if (items === undefined) return undefined;
  const isMap = ([first = '']: readonly string[]): boolean =>
    MAP_ENTRY.test(first) && !/^["']/.test(first);
  const maps = items.filter(isMap).length;
  if (maps === 0) return scalarItems(items, reading);
  if (maps !== items.length) return undefined;
  const entries: Record<string, string | boolean>[] = [];
  for (const lines of items) {
    const entry = mapItem(lines, reading);
    if (entry === undefined) return undefined;
    entries.push(entry);
  }
  return entries;
}

/** The block's `-` items, each as its lines; undefined when the block is not one flat list. */
function blockItems(block: readonly string[]): string[][] | undefined {
  const items: string[][] = [];
  let itemIndent = -1;
  for (const line of block) {
    if (line.trim() === '') continue;
    const item = ITEM_LINE.exec(line);
    const indent = /^\s*/.exec(line)?.[0].length ?? 0;
    if (item !== null && (itemIndent === -1 || indent === itemIndent)) {
      itemIndent = indent;
      items.push([item[2] ?? '']);
    } else if (items.length > 0 && indent > itemIndent && item === null) {
      (items.at(-1) as string[]).push(line.trim());
    } else return undefined;
  }
  return items;
}

function scalarItems(items: readonly string[][], reading: Reading): string[] | undefined {
  const values: string[] = [];
  for (const lines of items) {
    if (UNREAD_ITEM_START.test(lines[0] ?? '')) return undefined;
    const value = scalarWithComment(lines.join(' '), reading);
    if (value === undefined) return undefined;
    values.push(value === null ? '' : String(value));
  }
  return values;
}

function mapItem(
  lines: readonly string[],
  reading: Reading,
): Record<string, string | boolean> | undefined {
  const entry: Record<string, string | boolean> = {};
  for (const line of lines) {
    const match = MAP_ENTRY.exec(line);
    const key = match?.[1] ?? '';
    const raw = match?.[2] ?? '';
    if (match === null || Object.hasOwn(entry, key) || UNREAD_ITEM_START.test(raw)) {
      return undefined;
    }
    const value = scalarWithComment(raw, reading);
    if (value === undefined) return undefined;
    entry[key] = value === null ? '' : value;
  }
  return entry;
}

function scalarOrInlineList(raw: string, reading: Reading): FrontmatterValue | undefined {
  const { text, comment } = withoutComment(raw);
  if (comment) reading.comments += 1;
  if (!text.startsWith('[')) return scalar(text);
  if (!text.endsWith(']')) return undefined;
  const parts = flowItems(text.slice(1, -1));
  if (parts === undefined) return undefined;
  const values: string[] = [];
  for (const part of parts) {
    const value = scalar(part);
    if (value === undefined) return undefined;
    values.push(value === null ? '' : String(value));
  }
  return values;
}

/** The items of a `[…]` list, split at commas outside quotes; undefined for nested lists or maps. */
function flowItems(inner: string): string[] | undefined {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let at = 0; at < inner.length; at += 1) {
    const char = inner[at] as string;
    if (quote === '"' && char === '\\') {
      current += `${char}${inner[at + 1] ?? ''}`;
      at += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if ((char === '"' || char === "'") && current.trim() === '') {
      quote = char;
    } else if (char === ',') {
      parts.push(current.trim());
      current = '';
      continue;
    } else if ('[]{}'.includes(char)) return undefined;
    current += char;
  }
  if (quote !== null) return undefined;
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

function scalarWithComment(raw: string, reading: Reading): string | boolean | null | undefined {
  const { text, comment } = withoutComment(raw);
  if (comment) reading.comments += 1;
  return scalar(text);
}

/** The value with a trailing ` # comment` (outside quotes) taken off. */
function withoutComment(raw: string): { text: string; comment: boolean } {
  let quote: '"' | "'" | null = null;
  for (let at = 0; at < raw.length; at += 1) {
    const char = raw[at] as string;
    const before = at === 0 ? ' ' : (raw[at - 1] as string);
    if (quote === '"' && char === '\\') at += 1;
    else if (quote !== null) {
      if (char === quote) quote = null;
    } else if ((char === '"' || char === "'") && /[\s[,]/.test(before)) {
      quote = char;
    } else if (char === '#' && /\s/.test(before)) {
      return { text: raw.slice(0, at).trim(), comment: true };
    }
  }
  return { text: raw.trim(), comment: false };
}

const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '0': '\0',
  '"': '"',
  '\\': '\\',
  '/': '/',
  ' ': ' ',
};

/**
 * A scalar: quotes taken off (`''` inside single quotes is one `'`, escapes
 * read inside double quotes), booleans and null read as such; undefined when
 * the text is not a scalar this reader understands (a quote left open, an
 * unknown escape).
 */
function scalar(raw: string): string | boolean | null | undefined {
  const text = raw.trim();
  if (text.startsWith("'")) {
    return /^'(?:[^']|'')*'$/.test(text) ? text.slice(1, -1).replace(/''/g, "'") : undefined;
  }
  if (text.startsWith('"')) return /^"(?:[^"\\]|\\.)*"$/.test(text) ? unescaped(text) : undefined;
  if (text === '' || text === '~' || text === 'null') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  return text;
}

function unescaped(quoted: string): string | undefined {
  let known = true;
  const value = quoted
    .slice(1, -1)
    .replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, code: string) => {
      if (code.length > 1) return String.fromCharCode(Number.parseInt(code.slice(1), 16));
      const escaped = ESCAPES[code];
      if (escaped === undefined) known = false;
      return escaped ?? code;
    });
  return known ? value : undefined;
}
