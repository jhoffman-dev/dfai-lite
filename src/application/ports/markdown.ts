import type { EditorDocument, ParsedBody } from '../../domain/markdown/index.ts';

/**
 * A note as the editor opens it: the frontmatter a note not yet migrated
 * still has (kept as its bytes, never shown for editing), its body, and the
 * body read into blocks that remember where they came from.
 */
export interface ParsedNote {
  readonly frontmatter: string | null;
  readonly body: string;
  readonly parsed: ParsedBody;
}

/**
 * Markdown read into the editor's document and written back from it. A save
 * is byte-preserving: every block the editor did not change keeps the bytes
 * it had, and so does the frontmatter.
 */
export interface MarkdownPort {
  parseNote(text: string): ParsedNote;
  serializeNote(note: ParsedNote, doc: EditorDocument): string;
}
