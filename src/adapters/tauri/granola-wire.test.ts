import { describe, expect, it } from 'vitest';
import { GranolaError } from '../../application/index.ts';
import { granolaErrorOf } from './granola.ts';
import { keyStatusOf, noteOf, notesPageOf, transcriptPageOf } from './granola-wire.ts';

/** `GET /v1/notes` as the OpenAPI spec shapes it; fictional. */
const LIST = {
  notes: [
    {
      id: 'not_Lk7pQ2rTs9vWx3',
      object: 'note',
      title: 'Larkspur Payroll renewal',
      owner: { name: 'Mara Quill', email: 'mara.quill@example.com' },
      created_at: '2026-11-17T16:58:12Z',
      updated_at: '2026-11-17T17:41:03Z',
    },
    { id: 'not_B2', title: null, updated_at: '2026-11-18T10:00:00Z' },
    { id: '../admin', title: 'Escape', updated_at: '2026-11-18T10:00:00Z' },
    { id: 'not_C3', title: 7, updated_at: '2026-11-18T10:00:00Z' },
    'nonsense',
  ],
  hasMore: true,
  cursor: 'eyJwYWdlIjoyfQ',
};

describe('Granola’s answers', () => {
  it('reads a page of notes, setting aside the ones not in the documented shape', () => {
    const page = notesPageOf(LIST);
    expect(page?.cursor).toBe('eyJwYWdlIjoyfQ');
    expect(page?.notes.map(({ id }) => id)).toEqual(['not_Lk7pQ2rTs9vWx3', 'not_B2']);
    expect(page?.unreadable).toEqual([
      { id: '../admin', reason: 'its id is not a Granola note id' },
      { id: 'not_C3', reason: 'its title is not text' },
      { id: null, reason: 'it is not a note' },
    ]);
  });

  it('ends the listing on the last page, and refuses a page that says more but gives no cursor', () => {
    expect(notesPageOf({ notes: [], hasMore: false, cursor: null })?.cursor).toBeNull();
    expect(notesPageOf({ notes: [], hasMore: true, cursor: '' })).toBeNull();
    expect(notesPageOf({ notes: 'x', hasMore: false })).toBeNull();
    expect(notesPageOf([])).toBeNull();
  });

  it('reads the note asked for, and nothing else', () => {
    const note = {
      id: 'not_B2',
      title: 'Tobias 1:1',
      updated_at: '2026-11-18T10:00:00Z',
      web_url: 'https://notes.granola.ai/d/b2',
      transcript: [{ text: 'Hi' }],
      summary_markdown: '## Plan',
    };
    expect(noteOf(note, 'not_B2')).toMatchObject({ web_url: 'https://notes.granola.ai/d/b2' });
    expect(noteOf({ ...note, web_url: undefined, transcript: undefined }, 'not_B2')).toMatchObject({
      web_url: null,
      transcript: null,
    });
    expect(noteOf(note, 'not_OTHER')).toBeNull();
    expect(noteOf({ ...note, transcript: 'x' }, 'not_B2')).toBeNull();
    expect(noteOf({ ...note, updated_at: 1 }, 'not_B2')).toBeNull();
  });

  it('reads a page of a transcript', () => {
    expect(transcriptPageOf({ transcript: [{ text: 'Hi' }], hasMore: false })).toEqual({
      transcript: [{ text: 'Hi' }],
      cursor: null,
    });
    expect(transcriptPageOf({ transcript: [], hasMore: 'yes' })).toBeNull();
  });

  it('reads the host’s key status, which never holds a key', () => {
    expect(keyStatusOf({ hasKey: true, lastRefusal: 401 })).toEqual({
      hasKey: true,
      lastRefusal: 401,
    });
    expect(keyStatusOf({ hasKey: false, lastRefusal: null })).toEqual({
      hasKey: false,
      lastRefusal: null,
    });
    expect(keyStatusOf({ hasKey: true, lastRefusal: 403 })).toBeNull();
    expect(keyStatusOf({ key: 'grn_x' })).toBeNull();
  });

  it('turns the host’s rejection into the app’s error, by kind', () => {
    const timeout = granolaErrorOf({ kind: 'timeout', message: 'cannot reach Granola' });
    expect(timeout).toBeInstanceOf(GranolaError);
    expect(timeout.failure).toEqual({ kind: 'timeout', message: 'cannot reach Granola' });
    expect(granolaErrorOf({ kind: 'api_refused', message: 'x' }).failure.kind).toBe('invalid');
    expect(granolaErrorOf('missing argument').failure).toEqual({
      kind: 'invalid',
      message: 'missing argument',
    });
  });
});
