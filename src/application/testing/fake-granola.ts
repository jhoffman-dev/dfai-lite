import type { GranolaFailure, GranolaNote } from '../../domain/granola/index.ts';
import {
  GranolaError,
  type GranolaKeyStatus,
  type GranolaNotesPage,
  type GranolaPort,
} from '../granola/index.ts';

/** The fictional meeting the tests import: Granola's `Note`, in the API's shape. */
export function fictionalGranolaNote(change: Partial<Record<string, unknown>> = {}): GranolaNote {
  return {
    id: 'not_Lk7pQ2rTs9vWx3',
    object: 'note',
    title: 'Larkspur Payroll renewal',
    owner: { name: 'Mara Quill', email: 'mara.quill@example.com' },
    created_at: '2026-11-17T16:58:12Z',
    updated_at: '2026-11-17T17:41:03Z',
    web_url: 'https://notes.granola.ai/d/5f1e7c2a-0b3d-4e6f-9a8b-1c2d3e4f5a6b',
    calendar_event: {
      event_title: 'Larkspur Payroll renewal',
      invitees: [
        { email: 'mara.quill@example.com' },
        { email: 'TOBIAS.FENN@example.com' },
        { email: 'payroll-team@example.com' },
      ],
      scheduled_start_time: '2026-11-17T18:00:00Z',
      scheduled_end_time: '2026-11-17T18:30:00Z',
    },
    attendees: [
      { name: 'Mara Quill', email: 'mara.quill@example.com' },
      { name: 'Tobias Fenn', email: 'tobias.fenn@example.com' },
    ],
    summary_text: 'Plain text the note does not use when markdown is there.',
    summary_markdown:
      '## Renewal\n\nLarkspur Payroll renews at the current price with a sixty-day notice period.\n\n- Tobias sends the redline today',
    private_notes_markdown: '- Ask about the **onboarding** credit',
    transcript: [
      {
        speaker: { source: 'microphone', attribution: 'me' },
        text: 'Morning, Tobias. Shall we start with the renewal?',
        start_time: '2026-11-17T18:01:05Z',
        end_time: '2026-11-17T18:01:09Z',
      },
      {
        speaker: { source: 'speaker', attribution: 'them', name: 'Tobias Fenn' },
        text: 'Yes. Larkspur Payroll wants sixty days.',
        start_time: '2026-11-17T18:01:11.400Z',
        end_time: '2026-11-17T18:01:16Z',
      },
    ],
    ...change,
  } as GranolaNote;
}

/** Granola's answer as the port throws it. */
export const granolaRefusal = (status: number): GranolaError =>
  new GranolaError({ kind: 'api_refused', status, message: `Granola answered ${status}` });

/**
 * Granola in memory: notes by id, listed a page at a time, with what each
 * call was asked recorded. A failure set for a call is thrown by it.
 */
export class FakeGranola implements GranolaPort {
  readonly notes = new Map<string, GranolaNote>();
  key: string | null = 'grn_Fict10nalKey';
  refused = false;
  pageSize = 30;
  listFailure: GranolaError | null = null;
  readonly noteFailures = new Map<string, GranolaError>();
  readonly calls: string[] = [];

  add(note: GranolaNote): this {
    this.notes.set(note.id, note);
    return this;
  }

  private keyStatus(): GranolaKeyStatus {
    return {
      hasKey: this.key !== null,
      lastRefusal: this.refused && this.key !== null ? 401 : null,
    };
  }

  async status(): Promise<GranolaKeyStatus> {
    return this.keyStatus();
  }

  /** A key starting `grn_Wrong` is one Granola does not know. */
  async setKey({ key }: { key: string }): Promise<GranolaKeyStatus> {
    this.calls.push('setKey');
    this.key = key;
    this.refused = key.startsWith('grn_Wrong');
    return this.keyStatus();
  }

  async forgetKey(): Promise<GranolaKeyStatus> {
    this.calls.push('forgetKey');
    this.key = null;
    this.refused = false;
    return this.keyStatus();
  }

  private guard(failure?: GranolaError | null): void {
    if (this.key === null) throw new GranolaError(NO_KEY);
    if (this.refused) throw granolaRefusal(401);
    if (failure) throw failure;
  }

  async listNotes({
    updatedAfter,
    cursor,
  }: {
    updatedAfter: string | null;
    cursor: string | null;
  }): Promise<GranolaNotesPage> {
    this.calls.push(`list ${updatedAfter ?? 'all'} ${cursor ?? 'first'}`);
    this.guard(this.listFailure);
    const since = updatedAfter === null ? -Infinity : Date.parse(updatedAfter);
    const all = [...this.notes.values()].filter((note) => Date.parse(note.updated_at) > since);
    const from = cursor === null ? 0 : Number(cursor);
    const page = all.slice(from, from + this.pageSize);
    const next = from + this.pageSize < all.length ? String(from + this.pageSize) : null;
    const notes = page.map(({ id, title, updated_at }) => ({ id, title, updated_at }));
    return { notes, unreadable: [], cursor: next };
  }

  async getNote({ id, transcript }: { id: string; transcript: boolean }): Promise<GranolaNote> {
    this.calls.push(`get ${id}`);
    this.guard(this.noteFailures.get(id));
    const note = this.notes.get(id);
    if (note === undefined) throw granolaRefusal(404);
    return transcript ? note : { ...note, transcript: null };
  }

  async getTranscriptPage({ id }: { id: string }) {
    this.calls.push(`transcript ${id}`);
    this.guard();
    return { transcript: this.notes.get(id)?.transcript ?? [], cursor: null };
  }
}

const NO_KEY: GranolaFailure = {
  kind: 'no_key',
  message: 'no Granola API key is kept for this vault on this Mac',
};
