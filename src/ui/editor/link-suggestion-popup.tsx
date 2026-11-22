import { folderOf } from '../../application/index.ts';
import { SuggestionPopup, type PopupItem } from './suggestion-popup.tsx';
import type { LinkChoice, WikiSuggestionView } from './wiki-link-suggestion.ts';

/** The `[[` list: notes, each with where it lives, then "Create" for a new one. */
export function LinkSuggestionPopup({ view }: { view: WikiSuggestionView }) {
  return (
    <SuggestionPopup
      label="Link to note"
      variant="notes"
      items={view.items.map(popupItemOf)}
      selected={view.selected}
      rect={view.rect}
      onPick={(id) => {
        const item = view.items.find((candidate) => idOf(candidate) === id);
        if (item !== undefined) view.insert(item);
      }}
    />
  );
}

function idOf(item: LinkChoice): string {
  return item.kind === 'create' ? `create:${item.name}` : item.note.path;
}

function popupItemOf(item: LinkChoice): PopupItem {
  if (item.kind === 'create') {
    return { id: idOf(item), label: `Create ‘${item.name}’`, hint: 'New note' };
  }
  return { id: idOf(item), label: item.note.title, hint: folderOf(item.note.path) };
}
