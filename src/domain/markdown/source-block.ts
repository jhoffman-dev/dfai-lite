import type { EditorDocument } from './editor-node.ts';

/** One top-level markdown block, and exactly where it came from in the file. */
export interface SourceBlock {
  readonly id: string;
  /** Position among the original blocks, used to tell whether two were adjacent. */
  readonly index: number;
  /** The block's exact bytes in the original body. */
  readonly source: string;
  readonly start: number;
  readonly end: number;
  /** What `source` looks like after a parse-and-serialize round trip. */
  readonly normalized: string;
}

export interface ParsedBody {
  readonly blocks: readonly SourceBlock[];
  readonly doc: EditorDocument;
}
