import type { Ref } from 'react';
import { createPortal } from 'react-dom';
import { noteTitle } from '../../application/index.ts';
import type { ResolvedAppearance } from '../../domain/appearance/index.ts';
import type { VaultEntry } from '../../domain/vault/index.ts';
import { LookGlyph } from '../appearance/look-glyph.tsx';

/** The name a row shows: a note's title, a folder's last part. */
const nameOf = (entry: VaultEntry) =>
  entry.kind === 'note' ? noteTitle(entry.path) : (entry.path.split('/').at(-1) ?? entry.path);

/**
 * The small tile under the pointer while a row is dragged, DFAI's lifted
 * row: the row's glyph (its own icon, if it wears one) and name on a raised
 * card. It is drawn from the body, above everything, and placed by
 * `useTreeDrag` as the pointer moves; it stands in for the browser's own
 * drag picture, a ghost of the whole row. Hidden from assistive technology,
 * which hears the drag from the rows.
 */
export function DragTile({
  entry,
  look,
  tileRef,
}: {
  entry: VaultEntry;
  look: ResolvedAppearance | null;
  tileRef: Ref<HTMLDivElement>;
}) {
  return createPortal(
    <div ref={tileRef} className="tree-drag-tile" aria-hidden="true" data-testid="tree-drag-tile">
      <LookGlyph look={look} fallback={entry.kind === 'folder' ? 'folder' : 'doc'} />
      <span className="tree-drag-tile-name">{nameOf(entry)}</span>
    </div>,
    document.body,
  );
}
