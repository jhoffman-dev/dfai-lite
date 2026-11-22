import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import type { NoteSuggestion } from '../../domain/links/index.ts';
import { pickerSuggestion, type PickerView } from './picker-suggestion.ts';

/** What the `[[` list offers: a note, or a new note of the name typed. */
export type LinkChoice =
  | { readonly kind: 'note'; readonly note: NoteSuggestion }
  /** No note is called what was typed: make one of that name, and link it. */
  | { readonly kind: 'create'; readonly name: string };

export type WikiSuggestionView = PickerView<LinkChoice>;

export interface WikiLinkSuggestionOptions {
  /** Notes matching what has been typed so far. */
  suggest: (query: string) => readonly NoteSuggestion[];
  /** Called whenever the popup should appear, move, or close. */
  onView: (view: WikiSuggestionView | null) => void;
  /** Makes a note of a name no note has; null where notes cannot be made, and none is offered. */
  createNote: ((name: string) => void) | null;
}

/**
 * Offers notes after `[[`, then "Create" for a name no note answers to. The
 * link goes in as one atom with its brackets closed, so it is never left
 * half-formed.
 */
export const WikiLinkSuggestion = Extension.create<WikiLinkSuggestionOptions>({
  name: 'wikiLinkSuggestion',

  addOptions() {
    return { suggest: () => [], onView: () => {}, createNote: null };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      pickerSuggestion<LinkChoice>({
        editor: this.editor,
        pluginKey: new PluginKey('wikiLinkSuggestion'),
        char: '[[',
        startOfLine: false,
        allowSpaces: true,
        find: (query) =>
          withCreate(options.suggest(query), options.createNote === null ? '' : query),
        onView: (view) => options.onView(view),
        command: ({ editor, range, props: item }) => {
          const target = item.kind === 'note' ? item.note.target : item.name;
          insertLink(editor, range, target);
          if (item.kind === 'create') options.createNote?.(item.name);
        },
      }),
    ];
  },
});

/**
 * The notes offered for what was typed, then "Create" for it when no note
 * offered is called exactly that. An alias or a heading being typed (`|`,
 * `#`) is no plain name to make a note of.
 */
export function withCreate(notes: readonly NoteSuggestion[], query: string): LinkChoice[] {
  const choices: LinkChoice[] = notes.map((note) => ({ kind: 'note', note }));
  const name = query.trim();
  const offers =
    name !== '' && !/[|#^[\]]/.test(name) && !notes.some((note) => note.match === 'exact');
  return offers ? [...choices, { kind: 'create', name }] : choices;
}

/** The link as one atom, and a space after it, so typing goes on outside it. */
function insertLink(editor: Editor, range: Range, target: string): void {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: 'wikiLink', attrs: { target, heading: null, alias: null } },
      { type: 'text', text: ' ' },
    ])
    .run();
}
