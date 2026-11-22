import type { EditorDocument } from '../../domain/markdown/index.ts';

/**
 * The document as the editor holds it from the start: with the empty line
 * `TrailingLine` keeps to type in under a last list, table or picture (an
 * empty note is just that line), there before the first click rather than
 * after it. The save drops it while it is empty.
 */
export function editable(doc: EditorDocument): EditorDocument {
  const last = doc.content.at(-1);
  const typesAfter = last?.type === 'paragraph' && last.content?.at(-1)?.type !== 'image';
  return typesAfter ? doc : { ...doc, content: [...doc.content, { type: 'paragraph' }] };
}
