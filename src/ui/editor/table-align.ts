import { Extension } from '@tiptap/core';

/** A column's alignment, as GFM's `|:--|--:|` row writes it; null is none. */
type ColumnAlign = 'left' | 'right' | 'center' | null;

const isAlignments = (value: unknown): value is ColumnAlign[] =>
  Array.isArray(value) &&
  value.every(
    (align) => align === null || align === 'left' || align === 'right' || align === 'center',
  );

/**
 * Carries a table's column alignment, which the markdown reader puts on the
 * table node: without it the editor's document drops it, and the table is
 * written back with a plain `| - | - |` row the moment anything in the note
 * is typed. Written to the HTML too, so a copied table keeps it.
 */
export const TableAlign = Extension.create({
  name: 'tableAlign',

  addGlobalAttributes() {
    return [
      {
        types: ['table'],
        attributes: {
          align: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              try {
                const read: unknown = JSON.parse(element.getAttribute('data-align') ?? 'null');
                return isAlignments(read) ? read : null;
              } catch {
                // Not JSON, so not written by this app: the table has no alignment.
                return null;
              }
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              isAlignments(attrs['align']) ? { 'data-align': JSON.stringify(attrs['align']) } : {},
          },
        },
      },
    ];
  },
});
