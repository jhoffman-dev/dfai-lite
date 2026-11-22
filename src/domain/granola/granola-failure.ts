/*
 * Why an import from Granola did not do what was asked, and what the person
 * can do about it, lifted from DFAI. The host says what happened (a kind,
 * and the HTTP status Granola answered); what that means is decided here.
 */

export const GRANOLA_FAILURE_KINDS = [
  /** No API key is held on this Mac for the vault. */
  'no_key',
  /** The host would not send the request: no vault open, or not the one named. */
  'invalid',
  /** The Keychain would not give the host the key. */
  'keychain',
  'unreachable',
  'timeout',
  /** Granola's answer is larger than the host will read. */
  'too_large',
  /** Granola answered, but not in the shape its API documents. */
  'malformed',
  /** Granola answered a request with an error status; `status` is it. */
  'api_refused',
] as const;

export type GranolaFailureKind = (typeof GRANOLA_FAILURE_KINDS)[number];

export interface GranolaFailure {
  readonly kind: GranolaFailureKind;
  /** The HTTP status Granola answered with, for `api_refused`. */
  readonly status?: number;
  /** What the host said; never a response body, which may hold meeting content. */
  readonly message: string;
  /** True when the request that failed was for a page of a transcript (the remedy for a 413). */
  readonly transcriptPage?: boolean;
}

export function isGranolaFailureKind(value: unknown): value is GranolaFailureKind {
  return (GRANOLA_FAILURE_KINDS as readonly unknown[]).includes(value);
}

/**
 * What a failure means for the import:
 *
 * - `stop` when there is no key, the Keychain will not give it, Granola
 *   refused it (401), or the host will not send for this vault: every later
 *   request would fail the same way.
 * - `retry` for a failure that may pass by itself — the network, a timeout,
 *   408, 429, a 5xx, or a 413 for a whole transcript (read in pages next) —
 *   which holds the watermark so the next import lists the note again.
 * - `skip` for the rest — 404, 403, any other refusal, an answer that could
 *   not be read — which would fail the same way on every import.
 */
export type GranolaFailureEffect = 'stop' | 'skip' | 'retry';

const isTransientStatus = (status: number) =>
  status === 408 || status === 429 || (status >= 500 && status <= 599);

function statusEffect(status: number | undefined, transcriptPage: boolean): GranolaFailureEffect {
  if (status === undefined) return 'skip';
  if (status === 413) return transcriptPage ? 'skip' : 'retry';
  return isTransientStatus(status) ? 'retry' : 'skip';
}

export function granolaFailureEffect(failure: GranolaFailure): GranolaFailureEffect {
  switch (failure.kind) {
    case 'no_key':
    case 'invalid':
    case 'keychain':
      return 'stop';
    case 'unreachable':
    case 'timeout':
      return 'retry';
    case 'api_refused':
      if (failure.status === 401) return 'stop';
      return statusEffect(failure.status, failure.transcriptPage === true);
    default:
      return 'skip';
  }
}

/** Whether the failure is the network's: the Mac is offline, or Granola is out of reach. */
export const isOffline = (failure: GranolaFailure): boolean =>
  failure.kind === 'unreachable' || failure.kind === 'timeout';

/** Granola refused the key: the person needs to connect again with a new one. */
export const isKeyRefused = (failure: GranolaFailure | null): boolean =>
  failure?.kind === 'api_refused' && failure.status === 401;

const MAKE_A_KEY =
  'Create one in Granola → Settings → Connectors → API keys, and paste it in Settings → Granola.';

/** What went wrong, and what the person can do about it (null for nothing). */
interface Cause {
  readonly problem: string;
  readonly remedy: string | null;
}

function refusal(status: number | undefined, transcriptPage: boolean): Cause {
  if (status === 401) return { problem: 'Granola refused the API key.', remedy: MAKE_A_KEY };
  if (status === 403) {
    return {
      problem: 'Granola does not let this API key read the note.',
      remedy: 'Check the key’s scopes in Granola → Settings → Connectors → API keys.',
    };
  }
  if (status === 404) {
    return {
      problem: 'Granola no longer has the note, or it is no longer shared with you.',
      remedy: null,
    };
  }
  if (status === 413 && transcriptPage) {
    return {
      problem: 'A page of the meeting’s transcript is still too large for Granola to send.',
      remedy: null,
    };
  }
  if (status === 413) {
    return {
      problem: 'The meeting’s transcript is too large for Granola to send in one answer.',
      remedy: 'DFAI Lite reads a transcript that large in pages.',
    };
  }
  if (status === 408) return { problem: 'Granola did not answer in time.', remedy: null };
  if (status === 429) return { problem: 'Granola asked DFAI Lite to slow down.', remedy: null };
  if (status !== undefined && status >= 500 && status <= 599) {
    return { problem: `Granola is having trouble (status ${status}).`, remedy: null };
  }
  return { problem: `Granola refused the request (${status ?? 'no status'}).`, remedy: null };
}

function causeOf(failure: GranolaFailure): Cause {
  switch (failure.kind) {
    case 'api_refused':
      return refusal(failure.status, failure.transcriptPage === true);
    case 'no_key':
      return { problem: 'Granola is not connected on this Mac.', remedy: MAKE_A_KEY };
    case 'invalid':
      return { problem: `DFAI Lite could not ask Granola: ${failure.message}.`, remedy: null };
    case 'keychain':
      return {
        problem: `The Keychain did not give DFAI Lite the Granola API key: ${failure.message}.`,
        remedy: 'Unlock the Keychain, or paste the key again in Settings → Granola.',
      };
    case 'too_large':
      return { problem: 'Granola answered with more than DFAI Lite will read.', remedy: null };
    case 'unreachable':
    case 'timeout':
      return { problem: 'Granola could not be reached.', remedy: 'Check the connection.' };
    case 'malformed':
      return {
        problem: `Granola answered in a way DFAI Lite does not understand: ${failure.message}.`,
        remedy: null,
      };
    default:
      return { problem: `Granola could not be read: ${failure.message}.`, remedy: null };
  }
}

/** What the import did about it, one clause per effect. */
const OUTCOME: Readonly<Record<GranolaFailureEffect, string>> = {
  stop: 'Nothing more is imported until Granola accepts a key.',
  retry: 'The next import tries again.',
  skip: 'It was skipped; Import now tries it again.',
};

/** Where an import met a failure: listing the notes, or reading one of them. */
export type GranolaFailureContext = 'note' | 'listing';

function outcomeOf(failure: GranolaFailure, during: GranolaFailureContext): string {
  if (failure.kind === 'invalid' || failure.kind === 'keychain') {
    return 'This import stopped; the next one asks again.';
  }
  const effect = granolaFailureEffect(failure);
  if (during === 'listing' && effect !== 'stop') return 'The next import tries again.';
  return OUTCOME[effect];
}

/**
 * The failure in the person's words, with what to do and what the import
 * did about it: about a note, or — `listing` — about the list of notes.
 */
export function granolaFailureWords(
  failure: GranolaFailure,
  during: GranolaFailureContext = 'note',
): string {
  const { problem, remedy } = causeOf(failure);
  const outcome = outcomeOf(failure, during);
  return [problem, remedy, outcome].filter((part) => part !== null).join(' ');
}
