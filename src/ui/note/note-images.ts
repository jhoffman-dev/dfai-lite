import { readNoteImage, type VaultFiles, type VaultSession } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';

/** The pictures one open note shows, as the webview can draw them. */
export interface NoteImages {
  /** What `src` shows: a blob URL of the vault file's bytes, a web address, or null when missing. */
  load(src: string): Promise<string | null>;
  /** Lets every blob URL go; a later `load` reads afresh. */
  release(): void;
}

interface Held {
  readonly url: Promise<string | null>;
  /** The vault file read, once known: a change to it on disk lets the URL go. */
  path: VaultPath | null;
}

/**
 * The pictures of the note at `notePath`, as DFAI's `useImages` serves them:
 * read through the host when the editor first draws each one, so opening a
 * note never waits on a picture, and wrapped in a blob URL kept per source,
 * so one shown twice — or again in the viewer — is read once. A picture
 * changed on disk is read afresh the next time it is asked for. Every URL is
 * revoked on `release`, so a long session does not hold them all.
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
  let unsubscribe: (() => void) | null = null;

  const forget = (src: string, entry: Held) => {
    held.delete(src);
    void entry.url.then((url) => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    });
  };

  const watch = () => {
    unsubscribe ??= session.subscribe((change) => {
      if (change.kind !== 'file') return;
      for (const [src, entry] of held) if (entry.path === change.path) forget(src, entry);
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
      watch();
      const known = held.get(src);
      if (known !== undefined) return known.url;
      const entry: { path: VaultPath | null } = { path: null };
      const url = read(src, entry);
      held.set(src, Object.assign(entry, { url }));
      // A missing picture is asked again next time: it may have been added since.
      const drop = () => held.get(src)?.url === url && held.delete(src);
      void url.then((found) => found === null && drop(), drop);
      return url;
    },
    release() {
      for (const [src, entry] of held) forget(src, entry);
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
