import { createNoteMirror, type MirrorPeer } from './note-mirror.ts';

/** A view stand-in whose edits and documents are whole texts. */
function peer(initial: string): MirrorPeer<string, string> & { text: string; adopted: string[] } {
  const view = {
    text: initial,
    adopted: [] as string[],
    read: () => view.text,
    apply: (changes: string) => {
      view.text = changes;
    },
    adopt: (text: string) => {
      view.text = text;
      view.adopted.push(text);
    },
  };
  return view;
}

describe('the mirror between views on one note', () => {
  it('hands a typed edit to the other views, not back to the one typing', () => {
    const mirror = createNoteMirror<string, string>();
    const left = peer('Parallel run.');
    const right = peer('Parallel run.');
    const typing = mirror.join(left);
    mirror.join(right);
    left.apply = () => {
      throw new Error('A view must not be handed its own edit.');
    };
    typing.broadcast(() => 'Parallel run, twice.');
    expect(right.text).toBe('Parallel run, twice.');
  });

  it('does not read a typed edit when no other view is there to take it', () => {
    const mirror = createNoteMirror<string, string>();
    const alone = mirror.join(peer('Parallel run.'));
    alone.broadcast(() => {
      throw new Error('A lone view’s edit must not be read.');
    });
  });

  it('hands text typed as plain markdown to the other views as their new text', () => {
    const mirror = createNoteMirror<string, string>();
    const source = peer('# Plan');
    const editor = peer('# Plan');
    const typing = mirror.join(source);
    mirror.join(editor);
    typing.broadcastText('# Plan\n\nCut over.');
    expect(editor.adopted).toEqual(['# Plan\n\nCut over.']);
    expect(source.adopted).toEqual([]);
  });

  it('tells the first view it is alone, and a second one that it is not', () => {
    const mirror = createNoteMirror<string, string>();
    expect(mirror.join(peer('a')).alone).toBe(true);
    expect(mirror.join(peer('a')).alone).toBe(false);
  });

  it('starts a new view from a live one’s document, unsaved or not', () => {
    const mirror = createNoteMirror<string, string>();
    expect(mirror.liveDoc()).toBeNull();
    mirror.join(peer('Typed, not saved yet.'));
    expect(mirror.liveDoc()).toBe('Typed, not saved yet.');
  });

  it('keeps the last view’s document until its save lands, then defers to the vault', () => {
    const mirror = createNoteMirror<string, string>();
    const member = mirror.join(peer('Last keystrokes.'));
    member.leave();
    expect(mirror.liveDoc()).toBe('Last keystrokes.');
    mirror.settled();
    expect(mirror.liveDoc()).toBeNull();
  });

  it('does not let a save landing drop the document of a view still open', () => {
    const mirror = createNoteMirror<string, string>();
    mirror.join(peer('Still typing.'));
    mirror.settled();
    expect(mirror.liveDoc()).toBe('Still typing.');
  });
});

describe('a note’s new text from disk', () => {
  it('reaches every view on the note', () => {
    const mirror = createNoteMirror<string, string>();
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

  it('reaches no view that has left', () => {
    const mirror = createNoteMirror<string, string>();
    const gone = peer('Parallel run.');
    mirror.join(gone).leave();
    mirror.adopt('Parallel run, edited by Claude.');
    expect(gone.adopted).toEqual([]);
  });
});
