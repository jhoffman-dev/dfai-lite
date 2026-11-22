import type {
  GranolaFailure,
  GranolaNote,
  GranolaNoteSummary,
  GranolaUnreadableSummary,
} from '../../domain/granola/index.ts';

/**
 * Whether this vault has a Granola API key on this Mac, and 401 when
 * Granola's last answer to a request with it was a 401. Never the key.
 */
export interface GranolaKeyStatus {
  readonly hasKey: boolean;
  readonly lastRefusal: 401 | null;
}

/** One page of `GET /v1/notes`. */
export interface GranolaNotesPage {
  readonly notes: readonly GranolaNoteSummary[];
  /** The page's notes not in the documented shape: left out, the rest of the page kept. */
  readonly unreadable: readonly GranolaUnreadableSummary[];
  /** Where the next page starts; null on the last. */
  readonly cursor: string | null;
}

/** One page of `GET /v1/notes/{id}/transcript`. */
export interface GranolaTranscriptPage {
  /** The page's turns, as Granola sent them: the mapper reads them. */
  readonly transcript: readonly unknown[];
  readonly cursor: string | null;
}

/**
 * Granola's API, through the host (DFAI's ADR-0034). The host keeps the key
 * and answers with none of it; every call names the vault it is for, so one
 * that lands after a switch is refused rather than sent with another's key.
 * Granola's error statuses come back as a {@link GranolaError} of kind
 * `api_refused`, with the status.
 */
export interface GranolaPort {
  status(args: { vault: string }): Promise<GranolaKeyStatus>;
  /** Keeps the key, and has Granola check it with one small listing; the status says what it answered. */
  setKey(args: { vault: string; key: string }): Promise<GranolaKeyStatus>;
  forgetKey(args: { vault: string }): Promise<GranolaKeyStatus>;
  /** A page of the notes updated after `updatedAfter` — every note when it is null — from `cursor`. */
  listNotes(args: {
    vault: string;
    updatedAfter: string | null;
    cursor: string | null;
  }): Promise<GranolaNotesPage>;
  /** A note, its transcript inline when asked for; too large to send inline is Granola's 413. */
  getNote(args: { vault: string; id: string; transcript: boolean }): Promise<GranolaNote>;
  getTranscriptPage(args: {
    vault: string;
    id: string;
    cursor: string | null;
  }): Promise<GranolaTranscriptPage>;
}

/** A Granola call that failed, with what the host or Granola said. */
export class GranolaError extends Error {
  override readonly name = 'GranolaError';
  readonly failure: GranolaFailure;

  constructor(failure: GranolaFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

/** What this Mac remembers of importing a vault from Granola. */
export interface GranolaRecord {
  /** Whether the app imports by itself (as it opens, and every 15 minutes). */
  readonly automatic: boolean;
  /** The `updated_at` the next automatic import lists from (less a day); null lists everything. */
  readonly watermark: string | null;
  /** When the last import that ran ended, as an ISO instant; null before one has. */
  readonly lastImportAt: string | null;
  /** What it did, in a few words. */
  readonly lastResult: string | null;
}

export const NO_GRANOLA_RECORD: GranolaRecord = {
  automatic: true,
  watermark: null,
  lastImportAt: null,
  lastResult: null,
};

/**
 * This Mac's record, per vault: kept off the vault, since the vault syncs
 * and a write on every import would be noise in it and a conflict between
 * Macs. Losing it costs one full listing, so neither method throws: a record
 * that cannot be read is read as none.
 */
export interface GranolaRecords {
  read(vault: string): GranolaRecord;
  write(vault: string, record: GranolaRecord): void;
}
