import { useEffect, useRef, useState } from 'react';
import type { MarkdownPort } from '../../application/index.ts';
import { latestOf, type EditorBridge } from '../editor/bridge.ts';
import type { OpenNote } from './open-notes.ts';
import { createSourcePeer, type SourcePeer } from './source-peer.ts';

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
  const source = useRef<SourcePeer | null>(null);

  useEffect(() => {
    let broadcast: (typed: string) => void = () => undefined;
    const made = createSourcePeer({
      note,
      markdown,
      start,
      show: setValue,
      broadcastText: (typed) => broadcast(typed),
    });
    const joined = note.mirror.join(made.peer);
    broadcast = joined.broadcastText;
    source.current = made;
    if (joined.alone && start.doc === null) bridgeNow.get().opened(text);
    return () => {
      made.dispose();
      joined.leave();
      source.current = null;
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
      // Another pane's typing, not yet written out here, is shown before a key lands on it.
      onFocus={() => source.current?.refresh()}
      onKeyDown={() => source.current?.refresh()}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setValue(next);
        source.current?.typed(next);
        bridgeNow.get().changed(() => source.current?.text() ?? next);
      }}
      onBlur={() => bridgeNow.get().blurred()}
    />
  );
}

/**
 * The text the view opens on, and the document it stands for: a live
 * view's, when the note is open already, else the vault's text alone.
 */
function startingText(note: OpenNote, text: string, markdown: MarkdownPort) {
  const live = note.mirror.liveDoc();
  const reading = note.base.current();
  if (live === null || reading === null) return { text, doc: null };
  return { text: markdown.serializeNote(reading.note, live), doc: live };
}
