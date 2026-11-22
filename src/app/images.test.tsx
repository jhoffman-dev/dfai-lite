import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { VaultPath } from '../domain/vault/index.ts';
import { giveElementsASize, renderApp } from '../ui/testing/render-app.tsx';
import { loadMarkdown } from './app-boot.ts';

/*
 * A note's pictures in the editor, on the real markdown reader and writer:
 * drawn from the vault's bytes, missing ones said so, resized by the handle
 * or the keyboard and saved as DFAI writes a size, and opened larger.
 */

const NOTE: VaultPath = 'Projects/Plan.md';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

const made: string[] = [];
const revoked: string[] = [];

beforeAll(() => {
  giveElementsASize();
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  document.elementFromPoint = () => null;
  // jsdom has no blob URLs: each made is named, and each revoked noted.
  URL.createObjectURL = () => {
    const url = `blob:test/${made.length + 1}`;
    made.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => void revoked.push(url);
});
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  made.length = 0;
  revoked.length = 0;
});

async function open(text: string, binaries: Record<VaultPath, Uint8Array> = {}) {
  const app = await renderApp({ files: { [NOTE]: text }, binaries, source: false, loadMarkdown });
  await go(`#/note/${encodeURIComponent(NOTE)}`);
  const box = await screen.findByRole('textbox', { name: 'Note text' }, { timeout: 8000 });
  const editor = (box as HTMLElement & { editor?: Editor }).editor!;
  return { ...app, box, editor };
}

const savedAs = async (app: Awaited<ReturnType<typeof open>>, text: string) =>
  waitFor(() => expect(app.services.session.file(NOTE)?.text).toBe(text), { timeout: 3000 });

describe('a picture in a note', () => {
  it('is drawn from the vault file beside the note, read once for two of it', async () => {
    const { box } = await open('![Chart](chart.png) and ![Chart](chart.png)\n', {
      'Projects/chart.png': PNG,
    });
    const images = await within(box).findAllByRole('img', { name: 'Chart' });
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      'blob:test/1',
      'blob:test/1',
    ]);
  });

  it('shows DFAI’s missing state, and viewing it changes nothing in the note', async () => {
    const text = 'See ![Gone](attachments/gone.png) here.\n';
    const app = await open(text);
    expect(await within(app.box).findByText('Missing image: attachments/gone.png')).toBeVisible();
    expect(app.services.session.file(NOTE)?.text).toBe(text);
    expect(await app.services.files.read(NOTE)).toBe(text);
  });

  it('is drawn at the width the note gives it', async () => {
    const { box } = await open('![Chart|240](chart.png)\n', { 'Projects/chart.png': PNG });
    const image = await within(box).findByRole('img', { name: 'Chart' });
    expect(image).toHaveStyle({ width: '240px' });
  });

  it('is resized by its handle, and the note saves only its size', async () => {
    const app = await open('# Plan\n\n![Chart](chart.png)\n\n*  odd list\n', {
      'Projects/chart.png': PNG,
    });
    const image = await within(app.box).findByRole('img', { name: 'Chart' });
    image.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 100 });
    const handle = image.parentElement!.querySelector('.image__handle--right')!;
    fireEvent.pointerDown(handle, { button: 0, clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 240, pointerId: 1 });
    expect(image).toHaveStyle({ width: '240px' });
    // No wider than the line it is in (260px here), however far it is dragged.
    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
    expect(image).toHaveStyle({ width: '260px' });
    fireEvent.pointerMove(handle, { clientX: 230, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    await savedAs(app, '# Plan\n\n![Chart|230](chart.png)\n\n*  odd list\n');
  });

  it('goes back to its own size on a double-click of a handle', async () => {
    const app = await open('![Chart|420](chart.png)\n', { 'Projects/chart.png': PNG });
    const image = await within(app.box).findByRole('img', { name: 'Chart' });
    fireEvent.doubleClick(image.parentElement!.querySelector('.image__handle--left')!);
    await savedAs(app, '![Chart](chart.png)\n');
  });

  it('is resized from the keyboard once selected', async () => {
    const app = await open('![Chart](chart.png)\n', { 'Projects/chart.png': PNG });
    const image = await within(app.box).findByRole('img', { name: 'Chart' });
    image.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 160, height: 100 });
    act(() => {
      app.editor.commands.setNodeSelection(1);
      app.editor.commands.keyboardShortcut('Shift-ArrowRight');
    });
    await savedAs(app, '![Chart|200](chart.png)\n');
  });
});

describe('a picture opened larger', () => {
  it('opens on a click, steps to the next, and closes on Escape', async () => {
    const { box } = await open('![One](a.png) ![Two](b.png)\n', {
      'Projects/a.png': PNG,
      'Projects/b.png': PNG,
    });
    const [first] = await within(box).findAllByRole('img', { name: 'One' });
    fireEvent.click(first!);
    const viewer = await screen.findByRole('dialog', { name: 'One' });
    expect(within(viewer).getByText('1 of 2')).toBeVisible();
    expect(await within(viewer).findByRole('img', { name: 'One' })).toHaveAttribute('src');
    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    expect(within(viewer).getByText('2 of 2')).toBeVisible();
    fireEvent.keyDown(viewer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens from the keyboard with Space on the selected image, and zooms with ⌘+', async () => {
    const app = await open('![One](a.png)\n', { 'Projects/a.png': PNG });
    await within(app.box).findByRole('img', { name: 'One' });
    act(() => {
      app.editor.commands.setNodeSelection(1);
      app.editor.commands.keyboardShortcut('Space');
    });
    const viewer = await screen.findByRole('dialog', { name: 'One' });
    // The focus is held inside the viewer, as Base UI's dialog holds it.
    await waitFor(() => expect(viewer.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(viewer, { key: '+', metaKey: true });
    expect(within(viewer).getByRole('status', { name: 'Zoom' })).toHaveTextContent('125%');
    fireEvent.click(within(viewer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(app.services.session.file(NOTE)?.text).toBe('![One](a.png)\n');
  });
});

describe('a note closed', () => {
  it('lets its pictures’ blob URLs go', async () => {
    const { box, unmount } = await open('![One](a.png)\n', { 'Projects/a.png': PNG });
    await within(box).findByRole('img', { name: 'One' });
    unmount();
    await waitFor(() => expect(revoked).toEqual(made));
  });
});
