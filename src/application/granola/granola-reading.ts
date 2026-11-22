import {
  transcriptCharacters,
  transcriptOverLimit,
  type GranolaNote,
  type GranolaNoteSummary,
  type GranolaUnreadableSummary,
} from '../../domain/granola/index.ts';
import type { GranolaSend } from './granola-requests.ts';
import {
  GranolaError,
  type GranolaNotesPage,
  type GranolaPort,
  type GranolaTranscriptPage,
} from './ports.ts';

/*
 * Reading from Granola, lifted from DFAI: every page of the list, and a note
 * with its transcript inline or, past Granola's 413, a page at a time.
 */

/** What reading needs: the port, the vault the calls are for, and the paced sender. */
export interface GranolaReader {
  readonly granola: GranolaPort;
  readonly vault: string;
  readonly send: GranolaSend;
}

/** More pages of notes (thirty each) than anyone keeps; past it, a cursor that never ends. */
const MAX_LIST_PAGES = 2000;

const malformed = (message: string, transcriptPage = false) =>
  new GranolaError({ kind: 'malformed', message, ...(transcriptPage && { transcriptPage }) });

const unreadableKey = ({ id, reason }: GranolaUnreadableSummary): string =>
  id === null ? `no id: ${reason}` : `id: ${id}`;

/** What the list held: each note once, and those in a shape that cannot be read, each once. */
export interface GranolaListing {
  readonly notes: readonly GranolaNoteSummary[];
  readonly unreadable: readonly GranolaUnreadableSummary[];
}

/**
 * Every note listed since `updatedAfter` (every note when null), each once.
 * Granola documents no order for its list, so the whole of it is read before
 * the import decides anything by it. A cursor seen before ends it as malformed.
 */
export async function listGranolaNotes(
  { granola, vault, send }: GranolaReader,
  updatedAfter: string | null,
): Promise<GranolaListing> {
  const listed = new Map<string, GranolaNoteSummary>();
  const unreadable = new Map<string, GranolaUnreadableSummary>();
  const followed = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const from: string | null = cursor;
    const read: GranolaNotesPage = await send(() =>
      granola.listNotes({ vault, updatedAfter, cursor: from }),
    );
    for (const note of read.notes) listed.set(note.id, note);
    for (const summary of read.unreadable) {
      if (!unreadable.has(unreadableKey(summary))) unreadable.set(unreadableKey(summary), summary);
    }
    if (read.cursor === null) {
      const unread = [...unreadable.values()].filter(({ id }) => id === null || !listed.has(id));
      return { notes: [...listed.values()], unreadable: unread };
    }
    if (followed.has(read.cursor)) throw malformed('Granola sent the same page of notes again');
    followed.add(read.cursor);
    cursor = read.cursor;
  }
  throw malformed(`the list of notes ran past ${MAX_LIST_PAGES} pages`);
}

const isTooLarge = (error: unknown) =>
  error instanceof GranolaError &&
  error.failure.kind === 'api_refused' &&
  error.failure.status === 413;

/** A note as read; `tooLong` when its transcript is past the domain's limit. */
export interface GranolaNoteRead {
  readonly tooLong: boolean;
  readonly note: GranolaNote;
}

const inlineOverLimit = (transcript: readonly unknown[] | null) =>
  transcript !== null &&
  transcriptOverLimit({ characters: transcriptCharacters(transcript), pages: 1 });

/**
 * A note with its transcript, held to the domain's limit whether Granola
 * sent it inline or in pages. One too large for Granola to send inline
 * (413) is read a page at a time from its own endpoint.
 */
export async function readGranolaNote(reader: GranolaReader, id: string): Promise<GranolaNoteRead> {
  const { granola, vault, send } = reader;
  try {
    const note = await send(() => granola.getNote({ vault, id, transcript: true }));
    return { tooLong: inlineOverLimit(note.transcript), note };
  } catch (error) {
    if (!isTooLarge(error)) throw error;
  }
  const note = await send(() => granola.getNote({ vault, id, transcript: false }));
  const transcript = await readTranscriptPages(reader, id);
  return transcript === null
    ? { tooLong: true, note }
    : { tooLong: false, note: { ...note, transcript } };
}

function pageFailure(error: unknown): unknown {
  if (!(error instanceof GranolaError)) return error;
  return new GranolaError({ ...error.failure, transcriptPage: true });
}

/** Every page of a note's transcript, in order; null once it passes the limit. */
async function readTranscriptPages(
  { granola, vault, send }: GranolaReader,
  id: string,
): Promise<readonly unknown[] | null> {
  const turns: unknown[] = [];
  const followed = new Set<string>();
  let characters = 0;
  let cursor: string | null = null;
  for (let pages = 1; ; pages += 1) {
    if (transcriptOverLimit({ characters, pages })) return null;
    const from: string | null = cursor;
    const page: GranolaTranscriptPage = await send(() =>
      granola.getTranscriptPage({ vault, id, cursor: from }),
    ).catch((error: unknown) => {
      throw pageFailure(error);
    });
    // Not spread: a page is Granola's to size, and a long one would pass the engine's argument limit.
    for (const turn of page.transcript) turns.push(turn);
    characters += transcriptCharacters(page.transcript);
    if (transcriptOverLimit({ characters, pages })) return null;
    if (page.cursor === null) return turns;
    if (followed.has(page.cursor)) {
      throw malformed('Granola sent the same page of a transcript again', true);
    }
    followed.add(page.cursor);
    cursor = page.cursor;
  }
}
