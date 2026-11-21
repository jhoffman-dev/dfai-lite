import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Annotation, EditorState, Transaction, type ChangeSet } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import type { NoteMirror } from '../note/note-mirror.ts';
import type { EditorBridge } from './bridge.ts';
import { noteCompletions } from './completions.ts';
import { linkPills } from './link-pills.ts';
import { markdownStyle } from './markdown-style.ts';
import './editor.css';

/** Marks an edit another editor on the same note made: applied here, never saved or sent on. */
const mirrored = Annotation.define<boolean>();

interface Hooks {
  readonly bridge: () => EditorBridge;
  /** A typed edit, for the other editors on the note. */
  readonly typed: (changes: ChangeSet) => void;
}

function editorState(text: string, { bridge, typed }: Hooks, cursor: number | null): EditorState {
  const head = cursor === null ? undefined : Math.min(cursor, text.length);
  return EditorState.create({
    doc: text,
    ...(head === undefined ? {} : { selection: { anchor: head } }),
    extensions: [
      history(),
      closeBrackets(),
      markdown({ base: markdownLanguage }),
      markdownStyle(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': 'Note text', spellcheck: 'true' }),
      placeholder('Start typing…'),
      highlightSelectionMatches(),
      linkPills(bridge),
      noteCompletions(bridge),
      keymap.of([
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        const fromMirror = update.transactions.some((tr) => tr.annotation(mirrored) === true);
        if (update.docChanged && !fromMirror) {
          typed(update.changes);
          bridge().changed(() => update.view.state.doc.toString());
        }
        if (update.focusChanged && !update.view.hasFocus) bridge().blurred();
      }),
    ],
  });
}

/**
 * CodeMirror on the note's raw markdown. Built once per tab and note (the
 * parent keys it); React never re-renders it on a keystroke. Other editors
 * on the same note reach it only through `mirror`, as edits that map its
 * caret, so a note open twice stays one text and never jumps.
 */
export function NoteEditor({
  initialText,
  autoFocus,
  bridge,
  mirror,
  memory,
}: {
  initialText: string;
  autoFocus: boolean;
  bridge: EditorBridge;
  mirror: NoteMirror<ChangeSet>;
  /** The tab's caret, kept while the tab is hidden. */
  memory: { cursor: number | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(bridge);
  useEffect(() => {
    latest.current = bridge;
  });

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    let broadcast: (changes: ChangeSet) => void = () => undefined;
    const hooks: Hooks = { bridge: () => latest.current, typed: (changes) => broadcast(changes) };
    const view = new EditorView({ parent, state: editorState(initialText, hooks, memory.cursor) });
    const member = mirror.join({
      read: () => view.state.doc.toString(),
      apply: (changes, sourceText) => {
        // Always the same length while both follow each other; if not, take the whole text.
        const length = view.state.doc.length;
        const matches = changes.length === length;
        view.dispatch({
          changes: matches ? changes : { from: 0, to: length, insert: sourceText() },
          annotations: [mirrored.of(true), Transaction.addToHistory.of(false)],
        });
      },
    });
    broadcast = member.broadcast;
    // A second editor on the note starts from the first one's text, which may not be saved yet.
    if (member.alone) latest.current.opened(initialText);
    if (autoFocus) view.focus();
    return () => {
      memory.cursor = view.state.selection.main.head;
      member.leave();
      view.destroy();
      latest.current.closed();
    };
    // The editor owns its text once built: a new `initialText` is a new note, and a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="note-editor" />;
}
