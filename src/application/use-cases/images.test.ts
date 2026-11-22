import { FileExistsError, type ImageProbe } from '../ports/index.ts';
import { VaultSession, type VaultChange } from '../session/index.ts';
import { FixedClock, MemoryVaultFiles } from '../testing/index.ts';
import {
  applyExternalChanges,
  embedImage,
  ImageEmbedError,
  ImageRefusedError,
  openVault,
  readNoteImage,
  renameFolder,
  renameNote,
} from './index.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const NOTE = 'Projects/Larkspur Payroll.md';
/** 2026-09-25 14:30:12, local time: what names a pasted image. */
const PASTED_AT = new Date(2026, 8, 25, 14, 30, 12);

const drawsAll: ImageProbe = { canShow: async () => true };
const drawsNone: ImageProbe = { canShow: async () => false };

async function opened({
  texts = { [NOTE]: 'Plan.\n' },
  binaries = {},
  probe = drawsAll,
}: {
  texts?: Record<string, string>;
  binaries?: Record<string, Uint8Array>;
  probe?: ImageProbe;
} = {}) {
  const files = MemoryVaultFiles.of(texts, [], [], binaries);
  const session = new VaultSession();
  await openVault({ files, session });
  return { files, session, probe, clock: new FixedClock(PASTED_AT) };
}

const pasted = { name: 'image.png', mimeType: 'image/png', size: PNG.length, origin: 'clipboard' };
const readPng = async () => PNG;

describe('an image pasted or dropped into a note', () => {
  it('is saved in attachments/ as Obsidian names a paste, and the note is told how to point at it', async () => {
    const deps = await opened();
    const saved = await embedImage(deps, {
      notePath: NOTE,
      image: { ...pasted, origin: 'clipboard' },
      readBytes: readPng,
    });
    expect(saved).toEqual({
      path: 'attachments/Pasted image 20260925143012.png',
      src: '../attachments/Pasted%20image%2020260925143012.png',
      alt: '',
    });
    expect(deps.files.peekBinary(saved.path)).toEqual(PNG);
    expect(deps.session.otherPaths()).toContain(saved.path);
    expect(deps.session.folders()).toContain('attachments');
  });

  it('keeps a dropped file’s own name, as its alt text too', async () => {
    const deps = await opened();
    const saved = await embedImage(deps, {
      notePath: 'Today.md',
      image: { name: 'Q3 chart.png', mimeType: 'image/png', size: 11, origin: 'file' },
      readBytes: readPng,
    });
    expect(saved).toMatchObject({ src: 'attachments/Q3%20chart.png', alt: 'Q3 chart' });
  });

  it('never overwrites: a taken name, in any case, is numbered past', async () => {
    const deps = await opened({ binaries: { 'attachments/q3 CHART.png': PNG } });
    const image = {
      name: 'Q3 chart.png',
      mimeType: 'image/png',
      size: 11,
      origin: 'file',
    } as const;
    const first = await embedImage(deps, { notePath: NOTE, image, readBytes: readPng });
    const second = await embedImage(deps, { notePath: NOTE, image, readBytes: readPng });
    expect([first.path, second.path]).toEqual([
      'attachments/Q3 chart 2.png',
      'attachments/Q3 chart 3.png',
    ]);
    expect(deps.files.peekBinary('attachments/q3 CHART.png')).toEqual(PNG);
  });

  it('numbers past a name taken on disk that the session did not know yet', async () => {
    const deps = await opened();
    await deps.files.writeBinary({ path: 'attachments/a.png', bytes: new Uint8Array([1]) });
    const saved = await embedImage(deps, {
      notePath: NOTE,
      image: { name: 'a.png', mimeType: 'image/png', size: 11, origin: 'file' },
      readBytes: readPng,
    });
    expect(saved.path).toBe('attachments/a 2.png');
    expect(deps.files.peekBinary('attachments/a.png')).toEqual(new Uint8Array([1]));
  });

  it('gives several dropped at once a name each', async () => {
    const deps = await opened();
    const image = { name: 'shot.png', mimeType: 'image/png', size: 11, origin: 'file' } as const;
    const saved = await Promise.all(
      [1, 2, 3].map(() => embedImage(deps, { notePath: NOTE, image, readBytes: readPng })),
    );
    expect(saved.map((each) => each.path).sort()).toEqual([
      'attachments/shot 2.png',
      'attachments/shot 3.png',
      'attachments/shot.png',
    ]);
  });

  it('refuses, unread and unwritten, an image over 20 MB with its size', async () => {
    const deps = await opened();
    let read = false;
    const huge = { name: 'big.png', mimeType: 'image/png', size: 25 * 1024 * 1024, origin: 'file' };
    const saving = embedImage(deps, {
      notePath: NOTE,
      image: { ...huge, origin: 'file' },
      readBytes: async () => {
        read = true;
        return PNG;
      },
    });
    await expect(saving).rejects.toThrow(ImageRefusedError);
    await expect(saving).rejects.toThrow(
      '“big.png” is 25.0 MB. An image in a note can be at most 20 MB.',
    );
    expect(read).toBe(false);
    expect(deps.session.otherPaths()).toEqual([]);
  });

  it('refuses a file that is not an image, and one the webview cannot draw', async () => {
    const deps = await opened();
    const text = { name: 'notes.txt', mimeType: 'text/plain', size: 4, origin: 'file' } as const;
    await expect(
      embedImage(deps, { notePath: NOTE, image: text, readBytes: readPng }),
    ).rejects.toThrow('is not an image a note can hold');
    const undrawable = await opened({ probe: drawsNone });
    const heic = { name: 'IMG_1.heic', mimeType: 'image/heic', size: 4, origin: 'file' } as const;
    await expect(
      embedImage(undrawable, { notePath: NOTE, image: heic, readBytes: readPng }),
    ).rejects.toThrow('is a HEIC photo this Mac cannot show here');
    expect(undrawable.files.peekBinary('attachments/IMG_1.heic')).toBeUndefined();
  });

  it('says why when the disk will not take it', async () => {
    const deps = await opened();
    deps.files.writeBinary = async () => {
      throw new Error('the disk is full');
    };
    await expect(
      embedImage(deps, { notePath: NOTE, image: pasted as never, readBytes: readPng }),
    ).rejects.toThrow(new ImageEmbedError('The image could not be saved: the disk is full'));
  });

  it('stops after three names taken in a row', async () => {
    const deps = await opened();
    let tries = 0;
    deps.files.writeBinary = async () => {
      tries += 1;
      throw new FileExistsError('taken');
    };
    await expect(
      embedImage(deps, { notePath: NOTE, image: pasted as never, readBytes: readPng }),
    ).rejects.toThrow(ImageEmbedError);
    expect(tries).toBe(3);
  });
});

describe('an image a note shows', () => {
  it('is read beside the note first, then from the vault root', async () => {
    const deps = await opened({
      binaries: { 'Projects/pic.png': PNG, 'attachments/a.png': new Uint8Array([7]) },
    });
    expect(await readNoteImage(deps.files, { notePath: NOTE, src: 'pic.png' })).toEqual({
      kind: 'vault',
      path: 'Projects/pic.png',
      bytes: PNG,
      mimeType: 'image/png',
    });
    expect(await readNoteImage(deps.files, { notePath: NOTE, src: 'attachments/a.png' })).toEqual(
      expect.objectContaining({ path: 'attachments/a.png' }),
    );
  });

  it('is null when it is missing or would leave the vault, and a web address is itself', async () => {
    const deps = await opened();
    expect(await readNoteImage(deps.files, { notePath: NOTE, src: 'gone.png' })).toBeNull();
    expect(await readNoteImage(deps.files, { notePath: NOTE, src: '../../x.png' })).toBeNull();
    expect(
      await readNoteImage(deps.files, { notePath: NOTE, src: 'https://example.com/a.svg' }),
    ).toEqual({ kind: 'external', url: 'https://example.com/a.svg' });
  });

  it('shows an SVG by its type, as a picture', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const deps = await opened({ binaries: { 'attachments/d.svg': svg } });
    const read = await readNoteImage(deps.files, { notePath: 'a.md', src: 'attachments/d.svg' });
    expect(read).toMatchObject({ kind: 'vault', mimeType: 'image/svg+xml' });
  });
});

describe('a note that shows an image, moved', () => {
  it('has its relative image path rewritten from its new folder; the image stays', async () => {
    const deps = await opened({
      texts: {
        [NOTE]: 'See ![chart|300](../attachments/c.png "Q3") and ![](https://example.com/x.png).\n',
      },
      binaries: { 'attachments/c.png': PNG },
    });
    await renameNote(deps, { from: NOTE, to: 'Archive/2026/Larkspur Payroll.md' });
    expect(deps.files.peek('Archive/2026/Larkspur Payroll.md')).toBe(
      'See ![chart|300](../../attachments/c.png "Q3") and ![](https://example.com/x.png).\n',
    );
    expect(deps.files.peekBinary('attachments/c.png')).toEqual(PNG);
  });

  it('is left byte-identical when its images still resolve', async () => {
    const text = '![](attachments/c.png)\n';
    const deps = await opened({ texts: { 'a.md': text }, binaries: { 'attachments/c.png': PNG } });
    await renameNote(deps, { from: 'a.md', to: 'b.md' });
    expect(deps.files.peek('b.md')).toBe(text);
  });
});

describe('a folder moved with its pictures', () => {
  it('carries them, and re-points notes outside it that showed them', async () => {
    const deps = await opened({
      texts: { 'Home.md': 'Look: ![](Work/pic.png)\n', 'Work/a.md': '![](pic.png)\n' },
      binaries: { 'Work/pic.png': PNG },
    });
    await renameFolder(deps, { from: 'Work', to: 'Archive/Work' });
    expect(deps.files.peekBinary('Archive/Work/pic.png')).toEqual(PNG);
    expect(deps.files.peek('Home.md')).toBe('Look: ![](Archive/Work/pic.png)\n');
    expect(deps.files.peek('Archive/Work/a.md')).toBe('![](pic.png)\n');
  });
});

describe('a picture added or removed on disk by someone else', () => {
  it('is listed without reading the vault again', async () => {
    const deps = await opened();
    const changes: VaultChange[] = [];
    deps.session.subscribe((change) => changes.push(change));
    let wholeReads = 0;
    const readAll = deps.files.readAll.bind(deps.files);
    deps.files.readAll = () => {
      wholeReads += 1;
      return readAll();
    };
    await deps.files.writeBinary({ path: 'attachments/new.png', bytes: PNG });
    await applyExternalChanges(deps, ['attachments/new.png']);
    expect(deps.session.otherPaths()).toContain('attachments/new.png');
    await deps.files.remove({ path: 'attachments/new.png', expected: null, permanently: true });
    await applyExternalChanges(deps, ['attachments/new.png']);
    expect(deps.session.otherPaths()).not.toContain('attachments/new.png');
    expect(wholeReads).toBe(0);
    expect(changes).toEqual([
      { kind: 'file', path: 'attachments/new.png' },
      { kind: 'file', path: 'attachments/new.png' },
    ]);
  });

  it('reads the vault whole for any other kind of file', async () => {
    const deps = await opened();
    let wholeReads = 0;
    const readAll = deps.files.readAll.bind(deps.files);
    deps.files.readAll = () => {
      wholeReads += 1;
      return readAll();
    };
    await applyExternalChanges(deps, ['Docs/report.pdf']);
    expect(wholeReads).toBe(1);
  });
});
