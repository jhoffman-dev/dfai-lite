import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import type { VaultPath } from '../domain/vault/index.ts';
import { giveElementsASize, renderApp, TEST_VAULT } from '../ui/testing/render-app.tsx';
import { loadMarkdown } from './app-boot.ts';

/*
 * The note's tags on one line under its title, read from the note's own
 * text: never written to the file. Every name here is made up.
 */

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

beforeAll(() => {
  giveElementsASize();
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  document.elementFromPoint = () => null;
});
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

const PAYROLL: VaultPath = 'Projects/Larkspur Payroll.md';
const PLAIN: VaultPath = 'Projects/Plain.md';
const FILES = { ...TEST_VAULT, [PLAIN]: 'Nothing tagged here.\n' };

async function openNote(path: VaultPath, { source = false } = {}) {
  const app = await renderApp({ files: FILES, source, loadMarkdown });
  await go(`#/note/${encodeURIComponent(path)}`);
  const note = await screen.findByRole('article', { name: path.split('/').pop()!.slice(0, -3) });
  return { ...app, note };
}

const rowOf = (note: HTMLElement) => within(note).queryByRole('navigation', { name: 'Tags' });

async function editorIn(note: HTMLElement): Promise<Editor> {
  const field = await within(note).findByRole('textbox', { name: 'Note text' }, { timeout: 8000 });
  return (field as HTMLElement & { editor: Editor }).editor;
}

describe('the tags row under a note’s title', () => {
  it('shows the note’s tags as pills, nested ones in full, in the inline pill’s hue', async () => {
    const { note } = await openNote(PAYROLL);
    const row = rowOf(note)!;
    const pill = within(row).getByRole('button', { name: '#project/active' });
    await editorIn(note);
    const inline = await waitFor(() => {
      const found = note.querySelector('.editor .tag[data-tag="project/active"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(pill.getAttribute('data-hue')).toBe(inline.getAttribute('data-hue'));
  });

  it('follows the text: a tag typed shows in the row once saved, and the file has no row in it', async () => {
    const { note, services } = await openNote(PLAIN);
    expect(rowOf(note)).toBeNull();
    const editor = await editorIn(note);
    act(() => {
      editor.chain().focus('end').insertContent(' #errand').run();
    });
    const row = await within(note).findByRole('navigation', { name: 'Tags' }, { timeout: 3000 });
    expect(within(row).getByRole('button', { name: '#errand' })).toBeInTheDocument();
    expect(services.session.file(PLAIN)?.text).toBe('Nothing tagged here. #errand\n');
  });

  it('opens the tag in the Tags view when a pill is clicked', async () => {
    const { note } = await openNote(PAYROLL);
    await userEvent.click(within(rowOf(note)!).getByRole('button', { name: '#project/active' }));
    expect(
      await screen.findByRole('list', { name: 'Notes tagged project/active' }),
    ).toBeInTheDocument();
  });

  it('is not there for a note with no tags', async () => {
    const { note } = await openNote(PLAIN);
    expect(rowOf(note)).toBeNull();
    expect(note.querySelector('.note-tags')).toBeNull();
  });

  it('is hidden in the markdown view', async () => {
    const { note } = await openNote(PAYROLL, { source: true });
    expect(within(note).getByRole('textbox', { name: 'Note markdown' })).toBeInTheDocument();
    expect(rowOf(note)).toBeNull();
    fireEvent.click(within(note).getByRole('button', { name: /Markdown/ }));
    await waitFor(() => expect(rowOf(screen.getByRole('article'))).not.toBeNull());
  });
});
