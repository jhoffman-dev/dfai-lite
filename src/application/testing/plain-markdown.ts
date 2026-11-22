import type { EditorDocument } from '../../domain/markdown/index.ts';
import type { MarkdownPort } from '../ports/index.ts';

/**
 * A markdown port for tests of the app around a note: the whole note is
 * read as one block it does not model, and written back as that block's
 * text. Never a stand-in for the real reader in a test of what a save writes.
 */
export const plainMarkdown: MarkdownPort = {
  parseNote: (text) => ({
    frontmatter: null,
    body: text,
    parsed: {
      blocks: [],
      doc: { type: 'doc', content: [{ type: 'rawBlock', attrs: { markdown: text } }] },
    },
  }),
  serializeNote: (_note, doc: EditorDocument) =>
    doc.content.map((block) => String(block.attrs?.['markdown'] ?? '')).join('\n\n'),
};
