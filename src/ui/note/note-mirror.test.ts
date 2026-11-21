import { EditorSelection, EditorState } from '@codemirror/state';
import { createNoteMirror, editBetween, type MirrorPeer } from './note-mirror.ts';

/** An editor stand-in whose edits are whole texts. */
function peer(initial: string): MirrorPeer<string> & { text: string } {
  const editor = {
    text: initial,
    read: () => editor.text,
    apply: (changes: string) => {
      editor.text = changes;
    },
    adopt: (text: string) => {
      editor.text = text;
    },
  };
  return editor;
}

describe('the mirror between editors on one note', () => {
  it('hands a typed edit to the other editors, not back to the one typing', () => {
    const mirror = createNoteMirror<string>();
    const left = peer('Parallel run.');
    const right = peer('Parallel run.');
    const typing = mirror.join(left);
    mirror.join(right);
    left.apply = () => {
      throw new Error('An editor must not be handed its own edit.');
    };
    typing.broadcast('Parallel run, twice.');
    expect(right.text).toBe('Parallel run, twice.');
  });

  it('tells the first editor it is alone, and a second one that it is not', () => {
    const mirror = createNoteMirror<string>();
    expect(mirror.join(peer('a')).alone).toBe(true);
    expect(mirror.join(peer('a')).alone).toBe(false);
  });

  it('starts a new editor from a live one’s text, unsaved or not', () => {
    const mirror = createNoteMirror<string>();
    expect(mirror.liveText()).toBeNull();
    mirror.join(peer('Typed, not saved yet.'));
    expect(mirror.liveText()).toBe('Typed, not saved yet.');
  });

  it('keeps the last editor’s text until its save lands, then defers to the vault', () => {
    const mirror = createNoteMirror<string>();
    const member = mirror.join(peer('Last keystrokes.'));
    member.leave();
    expect(mirror.liveText()).toBe('Last keystrokes.');
    mirror.settled();
    expect(mirror.liveText()).toBeNull();
  });
});

describe('a note’s new text from disk', () => {
  it('reaches every editor on the note that does not have it yet', () => {
    const mirror = createNoteMirror<string>();
    const left = peer('Parallel run.');
    const right = peer('Parallel run.');
    mirror.join(left);
    mirror.join(right);
    mirror.adopt('Parallel run, edited by Claude.');
    expect([left.text, right.text]).toEqual([
      'Parallel run, edited by Claude.',
      'Parallel run, edited by Claude.',
    ]);
  });

  it('is found as the one run that differs, so the ends are left alone', () => {
    expect(editBetween('Parallel run.', 'Parallel dry run.')).toEqual({
      from: 9,
      to: 9,
      insert: 'dry ',
    });
    expect(editBetween('abcabc', 'abc')).toEqual({ from: 3, to: 6, insert: '' });
    expect(editBetween('same', 'same')).toEqual({ from: 4, to: 4, insert: '' });
    expect(editBetween('', 'new')).toEqual({ from: 0, to: 0, insert: 'new' });
  });

  it('keeps an editor’s caret on the words it was at, before or after the change', () => {
    const before = '# Plan\n\nParallel run.\n\nThen cut over.';
    const after = '# Plan\n\nParallel run for two cycles.\n\nThen cut over.';
    const caret = before.indexOf('cut');
    const state = EditorState.create({ doc: before, selection: EditorSelection.cursor(caret) });
    const next = state.update({ changes: editBetween(before, after) }).state;
    expect(next.doc.toString()).toBe(after);
    expect(next.selection.main.head).toBe(after.indexOf('cut'));
  });
});
