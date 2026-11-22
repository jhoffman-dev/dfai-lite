import { useEffect, useRef, useState } from 'react';
import type { MarkdownPort } from '../../application/index.ts';
import { latestOf, type EditorBridge } from '../editor/bridge.ts';
import type { MirrorMember } from './note-mirror.ts';
import type { EditorSteps, OpenNote } from './open-notes.ts';

interface SourceViewProps {
  /** The note's text in the vault, shown when no other view on it is live. */
  text: string;
  markdown: MarkdownPort;
  autoFocus: boolean;
  bridge: EditorBridge;
  note: OpenNote;
}

/**
 * The note as its plain markdown (⌘E), every character as the file has it,
 * typed in as text. One more view on the note: what is typed here reaches
 * the note's editors in other tabs, and what they type reaches it.
 */
export function SourceView({ text, markdown, autoFocus, bridge, note }: SourceViewProps) {
  const [bridgeNow] = useState(() => latestOf(bridge));
  useEffect(() => {
    bridgeNow.set(bridge);
  });
  const [start] = useState(() => startingText(note, text, markdown));
  const [value, setValue] = useState(start.text);
  const typed = useRef(start.text);
  const member = useRef<MirrorMember<EditorSteps> | null>(null);

  useEffect(() => {
    const show = (shown: string) => {
      typed.current = shown;
      setValue(shown);
    };
    const joined = note.mirror.join({
      read: () => note.base.readingOf(typed.current, markdown).note.parsed.doc,
      apply: (_steps, sourceDoc) => {
        const reading = note.base.current();
        if (reading !== null) show(markdown.serializeNote(reading.note, sourceDoc()));
      },
      adopt: show,
    });
    member.current = joined;
    if (joined.alone && start.fromVault) bridgeNow.get().opened(text);
    return () => {
      joined.leave();
      member.current = null;
      bridgeNow.get().closed();
    };
    // Built once per tab and note: the parent keys it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <textarea
      className="note-source"
      aria-label="Note markdown"
      value={value}
      // Spelling is underlined but never changed as you type: a corrected
      // word, like a smart quote, would change the markdown in the file.
      spellCheck
      autoCorrect="off"
      autoCapitalize="off"
      autoFocus={autoFocus}
      onChange={(event) => {
        const next = event.currentTarget.value;
        typed.current = next;
        setValue(next);
        member.current?.broadcastText(next);
        bridgeNow.get().changed(() => typed.current);
      }}
      onBlur={() => bridgeNow.get().blurred()}
    />
  );
}

/** The text the view opens on: a live view's, when the note is open already, else the vault's. */
function startingText(note: OpenNote, text: string, markdown: MarkdownPort) {
  const live = note.mirror.liveDoc();
  const reading = note.base.current();
  if (live === null || reading === null) return { text, fromVault: true };
  return { text: markdown.serializeNote(reading.note, live), fromVault: false };
}
