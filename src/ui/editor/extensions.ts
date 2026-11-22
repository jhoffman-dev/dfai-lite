import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import type { NoteSuggestion } from '../../domain/links/index.ts';
import type { TagSuggestion } from '../../domain/tags/index.ts';
import { BlockDrop } from './block-drop.ts';
import { BlockHandle } from './block-handle.ts';
import { BlockId } from './block-id.ts';
import { Callout } from './callout.ts';
import { codeLanguages } from './code-grammars.ts';
import { CodeHighlight } from './code-highlight.ts';
import { ControlKeys } from './control-keys.ts';
import { VaultImage, type ImageOptions } from './image.tsx';
import { RawBlock } from './raw-block.ts';
import { SlashCommands, type SlashCommandView } from './slash-commands.ts';
import { TableAlign } from './table-align.ts';
import { EmptyNote } from './empty-note.ts';
import { TagHighlight } from './tag-highlight.ts';
import { TagSuggestionExtension, type TagSuggestionView } from './tag-suggestion.ts';
import { TrailingLine } from './trailing-line.ts';
import { WikiLink } from './wiki-link.ts';
import { WikiLinkSuggestion, type WikiSuggestionView } from './wiki-link-suggestion.ts';

/**
 * The editor's node set, chosen to match what the markdown serializer can write.
 * Nothing is offered that cannot survive a round trip to markdown and back.
 */
export function createEditorExtensions({
  suggest,
  onView,
  onSlashView,
  suggestTags,
  onTagView,
  onOpenTag,
  createNote,
  images,
}: {
  suggest: (query: string) => readonly NoteSuggestion[];
  onView: (view: WikiSuggestionView | null) => void;
  onSlashView: (view: SlashCommandView | null) => void;
  /** Tags offered after `#`. */
  suggestTags: (query: string) => readonly TagSuggestion[];
  onTagView: (view: TagSuggestionView | null) => void;
  /** Opens the notes with a tag, when one is clicked. */
  onOpenTag: (name: string, click: MouseEvent) => void;
  /** Makes a note of a name typed after `[[` that no note has. */
  createNote: (name: string) => void;
  /** How the note's pictures are shown, and pasted or dropped ones saved. */
  images: ImageOptions;
}) {
  return [
    StarterKit.configure({
      // Markdown has no underline, so offering it would produce HTML in a .md file.
      underline: false,
      link: { openOnClick: false },
      // Colored by `CodeHighlight`, whose grammars load on first use.
      codeBlock: { languageClassPrefix: 'language-' },
      // Where a dragged block will land: a line drawn by the stylesheet, in the accent.
      dropcursor: { color: false, width: 2, class: 'editor-drop-line' },
      // Replaced by `TrailingLine`, which also leaves room to type after a last picture.
      trailingNode: false,
    }),
    TrailingLine,
    EmptyNote,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    TableAlign,
    Callout,
    WikiLink,
    BlockId,
    CodeHighlight.configure({ languages: codeLanguages }),
    ControlKeys,
    RawBlock,
    TagHighlight.configure({ onOpen: onOpenTag }),
    VaultImage.configure(images),
    WikiLinkSuggestion.configure({ suggest, onView, createNote }),
    TagSuggestionExtension.configure({ suggest: suggestTags, onView: onTagView }),
    SlashCommands.configure({ onView: onSlashView }),
    BlockHandle,
    BlockDrop,
  ];
}
