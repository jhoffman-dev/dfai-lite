import { plainMarkdown } from '../../application/testing/index.ts';
import type { EditorDocument } from '../../domain/markdown/index.ts';
import type { NoteBase, OpenNote, NoteReading } from './open-notes.ts';
import { createSourcePeer, SOURCE_REFRESH_MS } from './source-peer.ts';

const raw = (markdown: string): EditorDocument => ({
  type: 'doc',
  content: [{ type: 'rawBlock', attrs: { markdown } }],
});

/** A note's shared reading, counting how often it is read afresh. */
function baseOn(text: string) {
  let held: NoteReading = { text, note: plainMarkdown.parseNote(text) };
  const base: NoteBase & { rereads: number } = {
    rereads: 0,
    readingOf(next) {
      if (next !== held.text) {
        base.rereads += 1;
        held = { text: next, note: plainMarkdown.parseNote(next) };
      }
      return held;
    },
    current: () => held,
  };
  // Only the reading is the source view's to use; its saver and mirror are the pane's.
  return { base, note: { base } as unknown as OpenNote };
}

function setup(start: { text: string; doc: EditorDocument | null }) {
  const { base, note } = baseOn('Plan.');
  const shown: string[] = [];
  const sent: string[] = [];
  const source = createSourcePeer({
    note,
    markdown: plainMarkdown,
    start,
    show: (text) => shown.push(text),
    broadcastText: (text) => sent.push(text),
  });
  return { base, source, shown, sent };
}

describe('the markdown view beside an editor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes an editor’s typing out after a pause, not on every keystroke', () => {
    const { source, shown } = setup({ text: 'Plan.', doc: null });
    source.peer.apply([], () => raw('Plan. One'));
    source.peer.apply([], () => raw('Plan. One two'));
    expect(shown).toEqual([]);
    vi.advanceTimersByTime(SOURCE_REFRESH_MS);
    expect(shown).toEqual(['Plan. One two']);
  });

  it('writes it out at once when the person is about to type here', () => {
    const { source, shown } = setup({ text: 'Plan.', doc: null });
    source.peer.apply([], () => raw('Plan. One'));
    source.refresh();
    expect(shown).toEqual(['Plan. One']);
    expect(source.text()).toBe('Plan. One');
  });

  it('gives out the editor’s own document, so the note’s reading is never read afresh', () => {
    const { base, source } = setup({ text: 'Plan.', doc: null });
    const typed = raw('New top.\n\nPlan.');
    source.peer.apply([], () => typed);
    vi.advanceTimersByTime(SOURCE_REFRESH_MS);
    expect(source.peer.read()).toBe(typed);
    expect(base.rereads).toBe(0);
  });

  it('opening from a live editor, stands for that editor’s document', () => {
    const live = raw('Plan, live.');
    const { base, source } = setup({ text: 'Plan, live.', doc: live });
    expect(source.peer.read()).toBe(live);
    expect(base.rereads).toBe(0);
  });

  it('once typed in, hands the text to the other views and reads it as the note', () => {
    const { base, source, sent } = setup({ text: 'Plan.', doc: raw('Plan.') });
    source.typed('Plan, typed here.');
    expect(sent).toEqual(['Plan, typed here.']);
    expect(source.peer.read()).toEqual(raw('Plan, typed here.'));
    expect(base.rereads).toBe(1);
  });
});
