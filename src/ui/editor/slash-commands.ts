import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { offeredCallouts, resolveCallout } from '../../application/index.ts';
import type { CalloutSettings, CalloutType } from '../../domain/callouts/index.ts';
import { pickerSuggestion, type PickerView } from './picker-suggestion.ts';

export interface SlashCommand {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly run: (editor: Editor, range: Range) => void;
}

/**
 * Raised on the editor's element by "Image", asking the note for a file. An
 * event rather than a callback, so the note answers with what it holds now.
 */
export const IMAGE_REQUEST = 'lite:image-request';

/** Where the callout types go in the list: one command for each type the vault offers. */
const CALLOUTS = 'callouts';

/** A callout of `type`, empty, with the caret in it. */
const calloutCommand = (type: CalloutType, label: string): SlashCommand => ({
  id: `callout-${type.name.toLowerCase()}`,
  label: `Callout: ${label}`,
  hint: `> [!${type.name}]`,
  run: (editor, range) =>
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent({
        type: 'callout',
        attrs: { kind: type.name, title: null, fold: null },
        content: [{ type: 'paragraph' }],
      })
      .run(),
});

/** Only blocks the markdown serializer can write are offered. */
const BLOCK_COMMANDS: readonly (SlashCommand | typeof CALLOUTS)[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    hint: '#',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: '##',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: '###',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: 'Bullet list',
    hint: '-',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Numbered list',
    hint: '1.',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'task',
    label: 'Task list',
    hint: '- [ ]',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: '>',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Code block',
    hint: '```',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  CALLOUTS,
  {
    id: 'table',
    label: 'Table',
    hint: '| a | b |',
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
        .run(),
  },
  {
    // As DFAI's "Image": clears the typed `/image`, so the picked image lands where it was typed.
    id: 'image',
    label: 'Image',
    hint: '![]()',
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      editor.view.dom.dispatchEvent(new CustomEvent(IMAGE_REQUEST, { bubbles: true }));
    },
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: '---',
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

export type SlashCommandView = PickerView<SlashCommand>;

export interface SlashCommandsOptions {
  onView: (view: SlashCommandView | null) => void;
  /** The vault's callout types, each offered as a callout of its own. */
  callouts: () => CalloutSettings;
}

/** Every command, a callout of each type the vault offers where "callouts" stands. */
export function slashCommands(settings: CalloutSettings): SlashCommand[] {
  return BLOCK_COMMANDS.flatMap((command) =>
    command === CALLOUTS
      ? offeredCallouts(settings).map((type) =>
          calloutCommand(type, resolveCallout(type.name, settings).label),
        )
      : [command],
  );
}

const matching = (query: string, settings: CalloutSettings): SlashCommand[] => {
  const wanted = query.trim().toLowerCase();
  const commands = slashCommands(settings);
  if (wanted === '') return commands;
  return commands.filter((command) => command.label.toLowerCase().includes(wanted));
};

/** Blocks offered by typing `/` at the start of an empty line. */
export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'slashCommands',

  addOptions() {
    return { onView: () => {}, callouts: () => ({ types: [], hidden: [] }) };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      pickerSuggestion<SlashCommand>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommands'),
        char: '/',
        startOfLine: true,
        find: (query) => matching(query, options.callouts()),
        onView: (view) => options.onView(view),
        command: ({ editor, range, props: command }) => command.run(editor, range),
      }),
    ];
  },
});
