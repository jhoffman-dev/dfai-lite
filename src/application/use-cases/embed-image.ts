import {
  ATTACHMENTS_FOLDER,
  checkIncomingImage,
  defaultAltText,
  imageFileName,
  imageMimeType,
  localStamp,
  numberedFileName,
  relativeImageSource,
  undrawableImageMessage,
  type IncomingImage,
} from '../../domain/attachments/index.ts';
import { fileNameOf, folderOf, joinPath, type VaultPath } from '../../domain/vault/index.ts';
import type { Clock } from '../ports/clock.ts';
import type { ImageProbe } from '../ports/image-probe.ts';
import { FileExistsError } from '../ports/vault-files.ts';
import type { VaultDeps } from './vault-deps.ts';

/** Why an image did not go into a note, in words to show where it would have gone. */
export class ImageEmbedError extends Error {
  override readonly name: string = 'ImageEmbedError';
}

/**
 * The image itself was refused — too large, of a kind a note does not take,
 * or one this Mac cannot draw — before anything was written.
 */
export class ImageRefusedError extends ImageEmbedError {
  override readonly name = 'ImageRefusedError';
}

/** An image saved into the vault, and what the note writes to show it. */
export interface EmbeddedImage {
  readonly path: VaultPath;
  /** The destination of `![alt](src)`: relative to the note, percent-encoded. */
  readonly src: string;
  readonly alt: string;
}

/** What saving an image needs besides the vault: the webview's say on drawing it, and the time. */
export interface EmbedImageDeps extends VaultDeps {
  readonly probe: ImageProbe;
  readonly clock: Clock;
}

/**
 * Saves an image for a note and says how the note should point at it, as
 * DFAI does. The image is checked, then drawn by the webview, then written
 * into `attachments/` at the vault root — made if it is not there yet —
 * under a name numbered clear of every file already in it. Nothing is ever
 * overwritten: the host creates the file or refuses, and a name taken in
 * between is numbered past and tried again. The note itself is not touched;
 * inserting `![alt](src)` is the editor's, which owns the open note's writes.
 */
export async function embedImage(
  deps: EmbedImageDeps,
  {
    notePath,
    image,
    readBytes,
  }: {
    notePath: VaultPath;
    image: IncomingImage;
    /** Read only once the image has passed its checks, so a huge file is refused unread. */
    readBytes: () => Promise<Uint8Array>;
  },
): Promise<EmbeddedImage> {
  const check = checkIncomingImage(image);
  if (check.kind === 'refused') throw new ImageRefusedError(check.message);

  const now = localStamp(deps.clock.now());
  const name = imageFileName({ image, extension: check.extension, now });
  const bytes = await readBytes();
  if (!(await deps.probe.canShow({ bytes, mimeType: imageMimeType(name) }))) {
    throw new ImageRefusedError(
      undrawableImageMessage({ name: image.name, extension: check.extension }),
    );
  }

  const path = await writeUnderFreeName(deps, { folder: ATTACHMENTS_FOLDER, name, bytes });
  deps.session.applyOtherFile(path, true);
  return {
    path,
    src: relativeImageSource({ notePath, imagePath: path }),
    alt: defaultAltText(image),
  };
}

/** How many names are tried when each one is taken between listing and writing. */
const WRITE_ATTEMPTS = 3;

/**
 * The paths images being saved in this window are writing right now. Several
 * dropped or pasted at once all pick a name before any is written, so without
 * this each picks the same free name and all but one are refused.
 */
const beingWritten = new Set<VaultPath>();

/** Writes `bytes` as a new file in `folder` under `name`, numbered clear of what is there. */
async function writeUnderFreeName(
  { files, session }: VaultDeps,
  { folder, name, bytes }: { folder: VaultPath; name: string; bytes: Uint8Array },
): Promise<VaultPath> {
  const taken = namesIn(folder, [...session.takenPaths(), ...session.folders()]);
  for (let attempt = 1; ; attempt += 1) {
    // Picked and reserved in one synchronous step, so another save cannot pick the same name.
    const path = joinPath(
      folder,
      numberedFileName({ name, taken: [...taken, ...namesIn(folder, beingWritten)] }),
    );
    beingWritten.add(path);
    try {
      await files.writeBinary({ path, bytes });
      return path;
    } catch (error) {
      if (!(error instanceof FileExistsError) || attempt === WRITE_ATTEMPTS) {
        throw new ImageEmbedError(`The image could not be saved: ${messageOf(error)}`);
      }
      // Taken on disk though the session did not know it yet: numbered past.
      taken.push(fileNameOf(path));
    } finally {
      beingWritten.delete(path);
    }
  }
}

/** The names of the entries directly in `folder`, among `paths`. */
function namesIn(folder: VaultPath, paths: Iterable<VaultPath>): string[] {
  return [...paths].filter((path) => folderOf(path) === folder).map(fileNameOf);
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
