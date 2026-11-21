/** One editor on a note, as the mirror sees it. `C` is the editor's change type. */
export interface MirrorPeer<C> {
  /**
   * Applies another editor's edit, as an edit that is not saved or mirrored
   * again. `sourceText` reads that editor's whole text, for an editor that
   * cannot map the edit.
   */
  apply(changes: C, sourceText: () => string): void;
  /**
   * Takes the note's new text from disk, as an edit that is not saved or
   * mirrored, changing only what differs so the caret stays where it was.
   */
  adopt(text: string): void;
  read(): string;
}

/** The one replacement that turns `before` into `after`: what lies between their common ends. */
export interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/**
 * The smallest single edit from `before` to `after`, found from both ends,
 * so a caret outside the changed run maps through it unmoved.
 */
export function editBetween(before: string, after: string): TextEdit {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before[start] === after[start]) start += 1;
  let end = 0;
  while (
    end < shorter - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

export interface MirrorMember<C> {
  /** Whether this editor was the only one on the note when it joined. */
  readonly alone: boolean;
  /** Hands a typed edit to every other editor on the note. */
  broadcast(changes: C): void;
  leave(): void;
}

/**
 * Keeps every editor open on one note identical while typing, so the same
 * note in two panes never fights: an edit made in one is applied to the
 * others as the same change (their carets map through it, nothing jumps),
 * and only the editor typed in saves. The saved text stays in the vault;
 * this carries only the unsaved moment in between.
 */
export interface NoteMirror<C> {
  join(peer: MirrorPeer<C>): MirrorMember<C>;
  /**
   * The text an editor opening now must start from: a live editor's, or the
   * text the last editor left while its save is still landing. Null: the
   * vault's text is current.
   */
  liveText(): string | null;
  /** The last editor's save has landed: the vault's text is current again. */
  settled(): void;
  /** The note changed on disk with nothing typed waiting: every editor on it takes the new text. */
  adopt(text: string): void;
}

export function createNoteMirror<C>(): NoteMirror<C> {
  const peers = new Set<MirrorPeer<C>>();
  let leftBehind: string | null = null;

  return {
    join(peer) {
      const alone = peers.size === 0;
      peers.add(peer);
      return {
        alone,
        broadcast(changes) {
          for (const other of peers) if (other !== peer) other.apply(changes, peer.read);
        },
        leave() {
          peers.delete(peer);
          if (peers.size === 0) leftBehind = peer.read();
        },
      };
    },
    liveText() {
      const [live] = peers;
      return live?.read() ?? leftBehind;
    },
    settled() {
      if (peers.size === 0) leftBehind = null;
    },
    adopt(text) {
      for (const peer of peers) if (peer.read() !== text) peer.adopt(text);
    },
  };
}
