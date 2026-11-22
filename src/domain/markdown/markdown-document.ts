/**
 * A note split into its YAML frontmatter and its body.
 *
 * Lite notes have no frontmatter, but a note not yet migrated may still open
 * with one. `frontmatter` holds the whole leading block including both `---`
 * delimiters and the newline after the closing one, so `frontmatter + body` is
 * always exactly the original file. Kept as opaque text, the editor cannot
 * damage it.
 */
export interface MarkdownDocument {
  readonly frontmatter: string | null;
  readonly body: string;
  /** Where the body starts in the original text — the base for block source ranges. */
  readonly bodyOffset: number;
}

/**
 * A line consisting of exactly `---`, optionally with trailing spaces, then a
 * line end — after a byte-order mark, when the file has one, which is kept
 * with the frontmatter so the split stays lossless.
 */
const OPENING = /^\uFEFF?---[ \t]*\r?\n/;
const CLOSING = /^---[ \t]*(\r?\n|$)/;

/**
 * Frontmatter must open on the very first byte: a `---` anywhere else is a
 * horizontal rule. An unterminated block is not frontmatter either, which matches
 * how Obsidian reads the same file.
 */
export function splitFrontmatter(text: string): MarkdownDocument {
  const opening = OPENING.exec(text);
  if (opening === null) return { frontmatter: null, body: text, bodyOffset: 0 };

  let cursor = opening[0].length;
  while (cursor < text.length) {
    const lineEnd = text.indexOf('\n', cursor);
    const line = text.slice(cursor, lineEnd === -1 ? text.length : lineEnd + 1);
    if (CLOSING.test(line)) {
      const bodyOffset = lineEnd === -1 ? text.length : lineEnd + 1;
      return {
        frontmatter: text.slice(0, bodyOffset),
        body: text.slice(bodyOffset),
        bodyOffset,
      };
    }
    if (lineEnd === -1) break;
    cursor = lineEnd + 1;
  }

  return { frontmatter: null, body: text, bodyOffset: 0 };
}

/**
 * A note's text from its frontmatter and a new body, such that it splits back
 * into exactly those two.
 *
 * Frontmatter can close on the file's last byte, and a body glued onto that
 * `---` would leave the block unclosed and every property lost, so the body is
 * put on its own line. With no frontmatter, a body that would itself read as
 * frontmatter is pushed down a line so it stays body. Otherwise every byte is
 * kept, so an untouched note is written back as it was.
 */
export function joinFrontmatter(frontmatter: string | null, body: string): string {
  if (frontmatter === null) {
    return splitFrontmatter(body).frontmatter === null ? body : `\n${body}`;
  }
  const endsItsLine = frontmatter.endsWith('\n') || body === '';
  return endsItsLine ? frontmatter + body : `${frontmatter}\n${body}`;
}
