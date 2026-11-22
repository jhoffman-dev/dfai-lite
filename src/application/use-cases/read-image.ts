import { imageMimeType } from '../../domain/attachments/index.ts';
import { imageSourceCandidates, resolveImageSource } from '../../domain/markdown/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import type { VaultFiles } from '../ports/vault-files.ts';

/** What a note's `![alt](src)` shows: a web address as it is, or a vault file's bytes. */
export type NoteImage =
  | { readonly kind: 'external'; readonly url: string }
  | {
      readonly kind: 'vault';
      readonly path: VaultPath;
      readonly bytes: Uint8Array;
      readonly mimeType: string;
    };

/**
 * The image a note's `src` names, as DFAI finds it: beside the note first,
 * then from the vault root, the first file there winning. Null when there is
 * none (shown as missing), never an error: a missing picture does not fail
 * the note. Nothing is written.
 */
export async function readNoteImage(
  files: Pick<VaultFiles, 'readBinary'>,
  { notePath, src }: { notePath: VaultPath; src: string },
): Promise<NoteImage | null> {
  const source = resolveImageSource({ src, notePath });
  if (source.kind === 'external') return { kind: 'external', url: source.url };
  if (source.kind === 'unresolved') return null;
  for (const path of imageSourceCandidates({ src, notePath })) {
    try {
      const bytes = await files.readBinary(path);
      if (bytes !== null) return { kind: 'vault', path, bytes, mimeType: imageMimeType(path) };
    } catch {
      // Unreadable (a folder, past the host's ceiling): try the next place it could be.
    }
  }
  return null;
}
