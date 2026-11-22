import type { MarkdownPort } from '../../application/index.ts';
import type { EditorDocument } from '../../domain/markdown/index.ts';
import type { MirrorPeer } from './note-mirror.ts';
import type { EditorSteps, OpenNote } from './open-notes.ts';

/** How long the markdown view waits after an editor's typing before writing it out again. */
export const SOURCE_REFRESH_MS = 200;

/** The markdown view as one view on the note, apart from React. */
export interface SourcePeer {
  readonly peer: MirrorPeer<EditorSteps, EditorDocument>;
  /** The view's text, as it was typed here or last shown. */
  text(): string;
  /** Text typed here: the note's reading follows it, and the other views take it. */
  typed(text: string): void;
  /** Writes out now an editor's typing still waiting to be shown, before the person types here. */
  refresh(): void;
  dispose(): void;
}

/**
 * The note's markdown, typed as text, kept in step with the editors on the
 * same note without ever moving the reading their block ids come from:
 *
 * - While an editor's typing is the latest, this view holds that editor's
 *   document and gives it out as its own, so a view opening from it carries
 *   the ids the editors carry. Its text is written out from it after a pause,
 *   not on every keystroke: a long note takes a while to write.
 * - Once the person types here, the note's reading is that text, and every
 *   other view takes it (`broadcastText`), its ids included.
 */
export function createSourcePeer({
  note,
  markdown,
  start,
  show,
  broadcastText,
}: {
  note: OpenNote;
  markdown: MarkdownPort;
  start: { text: string; doc: EditorDocument | null };
  /** Draws the text; never reports it back as typed. */
  show: (text: string) => void;
  broadcastText: (text: string) => void;
}): SourcePeer {
  let text = start.text;
  /** An editor's document this view stands for, while nothing was typed here since. */
  const startDoc = start.doc;
  let held: (() => EditorDocument) | null = startDoc === null ? null : () => startDoc;
  let stale = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const refresh = () => {
    cancel();
    const reading = note.base.current();
    if (!stale || held === null || reading === null) return;
    stale = false;
    text = markdown.serializeNote(reading.note, held());
    show(text);
  };
  const shown = (next: string) => {
    cancel();
    held = null;
    stale = false;
    text = next;
    show(next);
  };

  return {
    peer: {
      read: () => held?.() ?? note.base.readingOf(text, markdown).note.parsed.doc,
      apply: (_steps, sourceDoc) => {
        held = sourceDoc;
        stale = true;
        cancel();
        timer = setTimeout(refresh, SOURCE_REFRESH_MS);
      },
      adopt: shown,
    },
    text: () => text,
    typed(next) {
      cancel();
      held = null;
      stale = false;
      text = next;
      broadcastText(next);
    },
    refresh,
    dispose: cancel,
  };
}
