import { readNoteImage, type VaultFiles, type VaultSession } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';

/** The pictures one open note shows, as the webview can draw them. */
export interface NoteImages {
  /** What `src` shows: a blob URL of the vault file's bytes, a web address, or null when missing. */
  load(src: string): Promise<string | null>;
  /**
   * Hears which sources to load again: the file one showed changed on disk,
   * or a picture that was missing may be there now. Returns the way to stop.
   */
  watch(listener: (src: string) => void): () => void;
  /** Lets every blob URL go; a later `load` reads afresh. */
  release(): void;
}

interface Held {
  readonly url: Promise<string | null>;
  /** The vault file read, once known: a change to it on disk asks the views to load it again. */
  path: VaultPath | null;
}

const revoke = (url: Promise<string | null>) =>
  void url.then(
    (made) => made?.startsWith('blob:') && URL.revokeObjectURL(made),
    // A read that failed made no URL: nothing to let go.
    () => undefined,
  );

const samePath = (left: VaultPath | null, right: VaultPath) =>
  left !== null && left.normalize('NFC').toLowerCase() === right.normalize('NFC').toLowerCase();

/**
 * The pictures of the note at `notePath`, as DFAI's `useImages` serves them:
 * read through the host when the editor first draws each one, so opening a
 * note never waits on a picture, and wrapped in a blob URL kept per source,
 * so one shown twice — or again in the viewer — is read once.
 *
 * A picture changed on disk is told to the views (`watch`), which load it
 * again; its old URL is let go only once the new one is made, so a view
 * still fetching it — a paste whose own watcher echo comes first — never
 * finds it gone. Every URL is revoked on `release`.
 */
export function createNoteImages({
  files,
  session,
  notePath,
}: {
  files: Pick<VaultFiles, 'readBinary'>;
  session: Pick<VaultSession, 'subscribe'>;
  notePath: VaultPath;
}): NoteImages {
  const held = new Map<string, Held>();
  /** URLs a changed file replaced, by source: revoked once the source's new one is made. */
  const replaced = new Map<string, Promise<string | null>[]>();
  /** Sources that resolved to no file: any file that appears may be theirs. */
  const missing = new Set<string>();
  const listeners = new Set<(src: string) => void>();
  let unsubscribe: (() => void) | null = null;

  const changed = (path: VaultPath) => {
    const again = new Set(missing);
    for (const [src, entry] of held) {
      if (!samePath(entry.path, path)) continue;
      held.delete(src);
      replaced.set(src, [...(replaced.get(src) ?? []), entry.url]);
      again.add(src);
    }
    for (const src of again) for (const listener of listeners) listener(src);
  };

  const follow = () => {
    unsubscribe ??= session.subscribe((change) => {
      if (change.kind === 'file') changed(change.path);
    });
  };

  const read = async (src: string, entry: { path: VaultPath | null }) => {
    const image = await readNoteImage(files, { notePath, src });
    if (image === null) return null;
    if (image.kind === 'external') return image.url;
    entry.path = image.path;
    // Bytes from the host are always over a plain ArrayBuffer, never a shared one.
    const bytes = image.bytes as Uint8Array<ArrayBuffer>;
    return URL.createObjectURL(new Blob([bytes], { type: image.mimeType }));
  };

  return {
    load(src) {
      follow();
      const known = held.get(src);
      if (known !== undefined) return known.url;
      const entry: { path: VaultPath | null } = { path: null };
      const url = read(src, entry);
      held.set(src, Object.assign(entry, { url }));
      void url.then(
        (found) => {
          for (const old of replaced.get(src) ?? []) revoke(old);
          replaced.delete(src);
          if (found !== null) missing.delete(src);
          else if (held.get(src)?.url === url) {
            // Asked again next time: it may have been added since.
            held.delete(src);
            missing.add(src);
          }
        },
        () => held.get(src)?.url === url && held.delete(src),
      );
      return url;
    },
    watch(listener) {
      follow();
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    release() {
      for (const entry of held.values()) revoke(entry.url);
      for (const urls of replaced.values()) urls.forEach(revoke);
      held.clear();
      replaced.clear();
      missing.clear();
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
