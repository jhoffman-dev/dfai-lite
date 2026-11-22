/**
 * One view on a note — an editor, or the note as plain text — as the mirror
 * sees it. `C` is an editor's change type, `D` its document.
 */
export interface MirrorPeer<C, D> {
  /**
   * Applies another editor's typed edit, as an edit that is not saved or
   * mirrored again. `sourceDoc` reads that editor's whole document, for a
   * view that cannot apply the edit.
   */
  apply(changes: C, sourceDoc: () => D): void;
  /**
   * Takes the note's new text — from disk, or typed as plain text in another
   * view — as an edit that is not saved or mirrored, changing only what
   * differs so the caret stays where it was.
   */
  adopt(text: string): void;
  read(): D;
}

export interface MirrorMember<C> {
  /** Whether this view was the only one on the note when it joined. */
  readonly alone: boolean;
  /** Hands a typed edit to every other view on the note; `changes` is read only if there is one. */
  broadcast(changes: () => C): void;
  /** Hands the note's whole text, typed as plain text here, to every other view on it. */
  broadcastText(text: string): void;
  leave(): void;
}

/**
 * Keeps every view open on one note identical while typing, so the same
 * note in two panes never fights: an edit made in one is applied to the
 * others as the same change (their carets map through it, nothing jumps),
 * and only the view typed in saves. The saved text stays in the vault;
 * this carries only the unsaved moment in between.
 */
export interface NoteMirror<C, D> {
  join(peer: MirrorPeer<C, D>): MirrorMember<C>;
  /**
   * The document a view opening now must start from: a live view's, or the
   * one the last view left while its save is still landing. Null: the
   * vault's text is current.
   */
  liveDoc(): D | null;
  /** The last view's save has landed: the vault's text is current again. */
  settled(): void;
  /** The note changed on disk with nothing typed waiting: every view on it takes the new text. */
  adopt(text: string): void;
}

export function createNoteMirror<C, D>(): NoteMirror<C, D> {
  const peers = new Set<MirrorPeer<C, D>>();
  let leftBehind: D | null = null;
  const othersThan = (peer: MirrorPeer<C, D>) => [...peers].filter((other) => other !== peer);

  return {
    join(peer) {
      const alone = peers.size === 0;
      peers.add(peer);
      return {
        alone,
        broadcast(changes) {
          const others = othersThan(peer);
          if (others.length === 0) return;
          const change = changes();
          for (const other of others) other.apply(change, peer.read);
        },
        broadcastText(text) {
          for (const other of othersThan(peer)) other.adopt(text);
        },
        leave() {
          peers.delete(peer);
          if (peers.size === 0) leftBehind = peer.read();
        },
      };
    },
    liveDoc() {
      const [live] = peers;
      return live?.read() ?? leftBehind;
    },
    settled() {
      if (peers.size === 0) leftBehind = null;
    },
    adopt(text) {
      for (const peer of peers) peer.adopt(text);
    },
  };
}
