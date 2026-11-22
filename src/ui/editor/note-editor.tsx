import { useEffect, useMemo, useState } from 'react';
import type { Editor, EditorEvents } from '@tiptap/core';
import { Step } from '@tiptap/pm/transform';
import { EditorContent, useEditor } from '@tiptap/react';
import type { MarkdownPort } from '../../application/index.ts';
import type { EditorDocument } from '../../domain/markdown/index.ts';
import type { EditorSteps, OpenNote } from '../note/open-notes.ts';
import { openInFor } from '../panes/open-in.ts';
import { useBlockMenu } from './block-menu.tsx';
import { latestOf, type EditorBridge } from './bridge.ts';
import { editable } from './editable-doc.ts';
import { createEditorExtensions } from './extensions.ts';
import { ImagePicker } from './image-picker.tsx';
import type { EmbedImage } from './image-uploads.ts';
import { LinkSuggestionPopup } from './link-suggestion-popup.tsx';
import { READ_FROM_FILE, showAsRead } from './show-as-read.ts';
import type { SlashCommandView } from './slash-commands.ts';
import { SuggestionPopup } from './suggestion-popup.tsx';
import { TagSuggestionPopup } from './tag-suggestion-popup.tsx';
import type { TagSuggestionView } from './tag-suggestion.ts';
import type { WikiSuggestionView } from './wiki-link-suggestion.ts';
import './editor.css';

/** Marks an edit another editor on the same note made: applied here, never saved or sent on. */
const MIRRORED = 'lite:mirrored';

interface NoteEditorProps {
  /** The note's text in the vault, read when no other view on it is live. */
  text: string;
  markdown: MarkdownPort;
  autoFocus: boolean;
  bridge: EditorBridge;
  note: OpenNote;
  /** The tab's caret, kept while the tab is hidden. */
  memory: { cursor: number | null };
}

/**
 * The note, edited as it reads: headings as headings, links and tags as
 * pills, checkboxes as checkboxes, and no markdown characters on screen.
 * Markdown shortcuts work as you type — `# `, `- `, `**bold**` — `[[`
 * offers notes, `#` tags and `/` blocks. Saved through the note's reading,
 * so every block the person did not touch keeps its bytes.
 *
 * Built once per tab and note (the parent keys it); React never re-renders
 * it on a keystroke. Other views on the same note reach it only through the
 * mirror, as the same steps, so a note open twice stays one document and
 * the caret never jumps.
 */
export function NoteEditor({ text, markdown, autoFocus, bridge, note, memory }: NoteEditorProps) {
  const [bridgeNow] = useState(() => latestOf(bridge));
  useEffect(() => {
    bridgeNow.set(bridge);
  });
  const [links, setLinks] = useState<WikiSuggestionView | null>(null);
  const [commands, setCommands] = useState<SlashCommandView | null>(null);
  const [tags, setTags] = useState<TagSuggestionView | null>(null);
  // The editor owns its document once built: a new `text` is a new note, and a new key.
  const [start] = useState(() => startingDoc(note, text, markdown));
  const [frontmatter, setFrontmatter] = useState(start.frontmatter);
  const [embedImage] = useState(() => {
    const embed: EmbedImage = (file, origin) => bridgeNow.get().embedImage(file, origin);
    return embed;
  });

  const extensions = useMemo(
    () =>
      createEditorExtensions({
        suggest: (query) => bridgeNow.get().suggestNotes(query),
        onView: setLinks,
        onSlashView: setCommands,
        suggestTags: (query) => bridgeNow.get().suggestTags(query),
        onTagView: setTags,
        onOpenTag: (name, click) => bridgeNow.get().openTag(name, openInFor(click)),
        createNote: (name) => bridgeNow.get().createLinkedNote(name),
        images: {
          loadImage: (src) => bridgeNow.get().loadImage(src),
          embedImage,
          watchImages: (listener) => bridgeNow.get().watchImages(listener),
        },
      }),
    [bridgeNow, embedImage],
  );

  const editor = useEditor({
    extensions,
    content: editable(start.doc) as object,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'editor',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Note text',
        // Spelling is underlined but never changed as you type: a corrected
        // word, like a smart quote, would change the markdown in the file.
        spellcheck: 'true',
        autocorrect: 'off',
        autocapitalize: 'off',
      },
    },
  });

  useEffect(() => {
    // StrictMode's second mount can hand back an editor its first unmount destroyed:
    // useEditor makes a new one, and this runs again with it.
    if (editor === null || editor.isDestroyed) return;
    const member = note.mirror.join({
      read: () => editor.getJSON() as EditorDocument,
      apply: (steps, sourceDoc) => applySteps(editor, steps, sourceDoc),
      adopt: (newText) => {
        const reading = note.base.readingOf(newText, markdown);
        setFrontmatter(reading.note.frontmatter);
        showAsRead(editor, reading.note.parsed.doc);
      },
    });
    const save = () => {
      const reading = note.base.current();
      if (reading === null) throw new Error('The editor saved a note it never read.');
      return markdown.serializeNote(reading.note, editor.getJSON() as EditorDocument);
    };
    const onTransaction = typedChanges((steps) => {
      member.broadcast(steps);
      bridgeNow.get().changed(save);
    });
    const onBlur = () => bridgeNow.get().blurred();
    editor.on('transaction', onTransaction);
    editor.on('blur', onBlur);
    if (member.alone && start.fromVault) bridgeNow.get().opened(text);
    placeCaret(editor, memory.cursor, autoFocus);
    return () => {
      memory.cursor = editor.state.selection.head;
      editor.off('transaction', onTransaction);
      editor.off('blur', onBlur);
      member.leave();
      bridgeNow.get().closed();
    };
    // Built once per editor: the note, its text and the port are the parent's key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const blockMenu = useBlockMenu(editor);

  // Delegated rather than bound per link, so links added while typing work too.
  // A plain click follows a link (a pill holds no caret); ⌘ opens a new tab, ⌥ the other pane.
  const followLink = (event: React.MouseEvent | React.KeyboardEvent, click: MouseLike) => {
    const element =
      event.target instanceof HTMLElement ? event.target.closest('[data-wikilink]') : null;
    if (element === null) return;
    event.preventDefault();
    bridgeNow.get().followLink(element.getAttribute('data-wikilink') ?? '', openInFor(click));
  };

  return (
    <div
      className="note-editor"
      onClick={(event) => followLink(event, event)}
      onAuxClick={(event) => event.button === 1 && followLink(event, event)}
      onKeyDown={(event) => {
        // A link pill has a tab stop and follows on Enter, as a link does.
        const onLink =
          event.target instanceof HTMLElement && event.target.matches('[data-wikilink]');
        if (event.key === 'Enter' && onLink) followLink(event, { ...event, button: 0 });
      }}
    >
      {frontmatter !== null && (
        <pre className="raw-block raw-block--frontmatter" title="Frontmatter — saved unchanged">
          {frontmatter}
        </pre>
      )}
      <EditorContent editor={editor} className="editor-host" />
      {blockMenu}
      <ImagePicker editor={editor} embed={embedImage} />
      {links !== null && <LinkSuggestionPopup view={links} />}
      {tags !== null && <TagSuggestionPopup view={tags} />}
      {commands !== null && (
        <SuggestionPopup
          label="Insert block"
          items={commands.items}
          selected={commands.selected}
          rect={commands.rect}
          onPick={(id) => {
            const command = commands.items.find((candidate) => candidate.id === id);
            if (command !== undefined) commands.insert(command);
          }}
        />
      )}
    </div>
  );
}

interface MouseLike {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

/**
 * The document the editor opens on: a live view's, when the note is open
 * already (its typing may not be saved yet), else the note's text read
 * afresh. Either way the reading it holds ids from is the note's base.
 */
function startingDoc(note: OpenNote, text: string, markdown: MarkdownPort) {
  const live = note.mirror.liveDoc();
  const held = note.base.current();
  if (live !== null && held !== null) {
    return { doc: live, frontmatter: held.note.frontmatter, fromVault: false };
  }
  const reading = note.base.readingOf(text, markdown);
  return { doc: reading.note.parsed.doc, frontmatter: reading.note.frontmatter, fromVault: true };
}

/**
 * A listener that hands on each edit typed here, with a reader of its steps
 * (the steps of the transactions appended to it included), and never one
 * mirrored from another editor or read from the file.
 */
function typedChanges(typed: (steps: () => EditorSteps) => void) {
  return ({ transaction, appendedTransactions }: EditorEvents['transaction']) => {
    const all = [transaction, ...appendedTransactions];
    if (!all.some((each) => each.docChanged)) return;
    if (transaction.getMeta(MIRRORED) === true || transaction.getMeta(READ_FROM_FILE) === true) {
      return;
    }
    typed(() => all.flatMap((each) => each.steps.map((step) => step.toJSON() as unknown)));
  };
}

/**
 * Applies another editor's steps here, unsaved and outside the undo
 * history. Both editors hold the same document, so the steps fit; should
 * they not, the other editor's whole document is taken instead.
 */
function applySteps(editor: Editor, steps: EditorSteps, sourceDoc: () => EditorDocument): void {
  const tr = editor.state.tr;
  if (!steps.every((json) => fits(() => tr.maybeStep(Step.fromJSON(editor.schema, json))))) {
    showAsRead(editor, sourceDoc());
    return;
  }
  editor.view.dispatch(tr.setMeta(MIRRORED, true).setMeta('addToHistory', false));
}

/** Whether a step was applied: one that does not fit, or cannot be read, was not. */
function fits(apply: () => { failed: string | null }): boolean {
  try {
    return apply().failed === null;
  } catch {
    // A step this schema cannot read is one that does not fit: the caller takes the whole document.
    return false;
  }
}

/** Puts the caret back where the tab left it, and takes the focus when asked to. */
function placeCaret(editor: Editor, cursor: number | null, focus: boolean): void {
  if (cursor !== null) {
    const at = Math.min(cursor, editor.state.doc.content.size);
    editor.commands.setTextSelection(at);
  }
  if (focus) editor.commands.focus(cursor === null ? 'start' : null);
}
