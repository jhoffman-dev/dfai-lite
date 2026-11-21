import { createNoteMirror, type MirrorPeer } from './note-mirror.ts';

/** An editor stand-in whose edits are whole texts. */
function peer(initial: string): MirrorPeer<string> & { text: string } {
  const editor = {
    text: initial,
    read: () => editor.text,
    apply: (changes: string) => {
      editor.text = changes;
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
