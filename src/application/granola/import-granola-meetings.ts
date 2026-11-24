import {
  granolaFailureEffect,
  granolaFailureWords,
  isKeyRefused,
  isOffline,
  nextWatermark,
  OFFLINE_IN_A_ROW,
  sinceOf,
  SLOW_DOWNS_IN_A_ROW,
  TRANSCRIPT_TOO_LONG,
  type GranolaCounts,
  type GranolaFailure,
  type GranolaNote,
  type GranolaNoteOutcome,
  type GranolaNoteResult,
  type GranolaNoteSummary,
  type GranolaPullEnd,
  type GranolaPullMode,
} from '../../domain/granola/index.ts';
import {
  findImport,
  fromGranola,
  IMPORTS_PATH,
  MeetingInputError,
  recordImport,
  withQueueWaiting,
  type ImportEntry,
  type ImportLedger,
} from '../../domain/meetings/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import type { Clock } from '../ports/index.ts';
import {
  ImportLedgerUnreadableError,
  readImportLedger,
  updateImportLedger,
  type VaultDeps,
} from '../use-cases/index.ts';
import { listGranolaNotes, readGranolaNote, type GranolaReader } from './granola-reading.ts';
import { isSlowDown, pacedRequests, type Wait } from './granola-requests.ts';
import { placeMeeting, sourcesIn } from './place-meeting.ts';
import { queueNewMeeting, queueWaitingMeetings } from './queue-new-meetings.ts';
import { GranolaError, type GranolaPort } from './ports.ts';

const PROVIDER = 'granola';

/** What one import needs. */
export interface GranolaImportDeps {
  /** The vault's files behind the sync write gate, and the session. */
  readonly vault: VaultDeps;
  readonly granola: GranolaPort;
  /** The vault's folder, as the host names it for the key. */
  readonly vaultKey: string;
  readonly clock: Clock;
  readonly wait: Wait;
  /** The zone the meetings' times are written on. */
  readonly timeZone: string;
  /** The person's own addresses: `me` in a meeting they own is written `You`. */
  readonly selfEmails: readonly string[];
}

/** A meeting that was not written, and why. Never what it says. */
export interface GranolaNoteProblem {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly problem: string;
}

/** What an import did. Nothing in it is a note's content, or the key. */
export interface GranolaImportReport {
  readonly mode: GranolaPullMode;
  readonly ended: GranolaPullEnd;
  readonly counts: GranolaCounts;
  /** The notes written or added to. */
  readonly written: readonly VaultPath[];
  /** Meetings refused, skipped (other than the person's deletions) or failed. */
  readonly problems: readonly GranolaNoteProblem[];
  /** Granola's failure that stopped or failed the import. */
  readonly failure: GranolaFailure | null;
  /** Why it stopped or failed, in the person's words; null when it did neither. */
  readonly problem: string | null;
  /** Granola refused the key (401): connect again with a new one. */
  readonly keyRefused: boolean;
  /** The import ledger could not be read, so the import stopped before anything was written. */
  readonly ledgerUnreadable: boolean;
  /** The watermark after the import: moved on only when every listed note was looked at. */
  readonly watermark: string | null;
}

/** What an import has done so far. */
interface Tally {
  readonly results: GranolaNoteResult[];
  readonly written: VaultPath[];
  readonly problems: GranolaNoteProblem[];
  readonly counts: Record<keyof GranolaCounts, number>;
  slowDownsInARow: number;
  offlineInARow: number;
}

/** One import under way. */
interface Run extends GranolaReader {
  readonly deps: GranolaImportDeps;
  readonly tally: Tally;
  readonly sources: Map<string, VaultPath>;
}

/** How an import ended, when a note ended it. */
interface Ending {
  readonly ended: GranolaPullEnd;
  readonly failure: GranolaFailure | null;
  readonly problem: string | null;
  readonly ledgerUnreadable?: boolean;
}

const COUNTED: Readonly<Record<GranolaNoteOutcome, keyof GranolaCounts>> = {
  imported: 'imported',
  updated: 'updated',
  unchanged: 'unchanged',
  refused: 'skipped',
  skipped: 'skipped',
  failed: 'failed',
};

/** The import stopped on the ledger: nothing was imported, and Settings says what to do. */
const ledgerStop = (reason: string): Ending => ({
  ended: 'stopped',
  failure: null,
  problem: `The import record (${IMPORTS_PATH}) cannot be read: ${reason} Nothing more is imported until it is mended in Settings → Granola.`,
  ledgerUnreadable: true,
});

function settle(
  run: Run,
  summary: GranolaNoteSummary,
  outcome: GranolaNoteOutcome,
  problem?: string,
  url: string | null = null,
): void {
  run.tally.results.push({ outcome, updatedAt: summary.updated_at });
  run.tally.counts[COUNTED[outcome]] += 1;
  if (problem === undefined) return;
  run.tally.problems.push({ id: summary.id, title: summary.title ?? summary.id, url, problem });
}

const failureOf = (error: unknown): GranolaFailure => {
  if (error instanceof GranolaError) return error.failure;
  throw error;
};

/**
 * Ends the import once Granola has refused (429) or not been reached for
 * several notes in a row: every note left would fail the same way, each
 * after its own wait. The notes not reached hold the watermark, so the next
 * import picks them up.
 */
function inARow(run: Run, failure: GranolaFailure): Ending | null {
  const { tally } = run;
  tally.slowDownsInARow = isSlowDown(failure) ? tally.slowDownsInARow + 1 : 0;
  tally.offlineInARow = isOffline(failure) ? tally.offlineInARow + 1 : 0;
  const stop =
    tally.slowDownsInARow >= SLOW_DOWNS_IN_A_ROW || tally.offlineInARow >= OFFLINE_IN_A_ROW;
  if (!stop) return null;
  const problem = `${granolaFailureWords(failure)} The meetings not reached are imported next time.`;
  return { ended: 'failed', failure, problem };
}

/** A note Granola would not give: left for the next import, skipped, or the end of the import. */
function noteFailed(run: Run, summary: GranolaNoteSummary, failure: GranolaFailure): Ending | null {
  const effect = granolaFailureEffect(failure);
  if (effect === 'stop') {
    return { ended: 'stopped', failure, problem: granolaFailureWords(failure) };
  }
  settle(run, summary, effect === 'retry' ? 'failed' : 'skipped', granolaFailureWords(failure));
  return inARow(run, failure);
}

/** Records this import's word on one meeting in the ledger as it is now, keeping every other entry. */
async function record(run: Run, entry: ImportEntry): Promise<void> {
  await updateImportLedger(run.deps.vault, (ledger) => recordImport(ledger, entry));
}

const entryFor = (summary: GranolaNoteSummary, path: VaultPath, source: string | null) => ({
  ...{ provider: PROVIDER, id: summary.id, path, source },
  ...{ updatedAt: summary.updated_at, dismissed: false },
});

/** The ledger as it is now; a ledger that became unreadable mid-import stops it. */
function ledgerNow(run: Run): ImportLedger {
  const parsed = readImportLedger(run.deps.vault.session);
  if (parsed.kind === 'malformed') throw new ImportLedgerUnreadableError(parsed.reason);
  return parsed.ledger;
}

/**
 * What the ledger already says, before anything is fetched: a meeting the
 * person deleted is skipped (its note gone, and no note carrying its source);
 * one whose note is there and that Granola has not changed since is
 * unchanged. False to fetch it.
 */
async function settledByLedger(run: Run, summary: GranolaNoteSummary): Promise<boolean> {
  const entry = findImport(ledgerNow(run), { provider: PROVIDER, id: summary.id });
  if (entry === null) return false;
  if (entry.dismissed) {
    settle(run, summary, 'skipped');
    return true;
  }
  const { session } = run.deps.vault;
  const movedTo = entry.source === null ? undefined : run.sources.get(entry.source);
  const path = session.file(entry.path) !== null ? entry.path : movedTo;
  if (path === undefined) {
    await record(run, { ...entry, dismissed: true });
    settle(run, summary, 'skipped');
    return true;
  }
  if (entry.updatedAt !== summary.updated_at) return false;
  if (path !== entry.path) await record(run, { ...entry, path });
  settle(run, summary, 'unchanged');
  return true;
}

/** Maps the note and puts it in the vault; refused by name when the mapper cannot read it. */
async function write(run: Run, summary: GranolaNoteSummary, note: GranolaNote): Promise<void> {
  const { deps } = run;
  let input;
  try {
    input = fromGranola(note, { timeZone: deps.timeZone, selfEmails: deps.selfEmails });
  } catch (error) {
    if (!(error instanceof MeetingInputError)) throw error;
    const problem = `Granola’s note could not be read: ${error.message}.`;
    settle(run, summary, 'refused', problem, note.web_url);
    return;
  }
  const ledger = ledgerNow(run);
  const found = findImport(ledger, { provider: PROVIDER, id: summary.id });
  const entry = found === null || found.dismissed ? null : found;
  const placed = await placeMeeting(deps.vault, {
    ...{ provider: PROVIDER, id: summary.id, input, entry },
    ...{ ledger, sources: run.sources },
  });
  if (placed.outcome !== 'unchanged') run.tally.written.push(placed.path);
  if (input.sourceUrl !== undefined) run.sources.set(input.sourceUrl, placed.path);
  // Only a note this import created is queued for Claude, once; a line that
  // could not be written waits in the ledger for the next import.
  const waiting =
    placed.outcome === 'imported'
      ? !(await queueNewMeeting(deps, placed.path))
      : entry?.queueWaiting === true;
  await record(
    run,
    withQueueWaiting(entryFor(summary, placed.path, input.sourceUrl ?? null), waiting),
  );
  settle(run, summary, placed.outcome);
}

/** Takes in one listed note; how the import ends, when this note ends it. */
async function takeIn(run: Run, summary: GranolaNoteSummary): Promise<Ending | null> {
  if (await settledByLedger(run, summary)) return null;
  let read;
  try {
    read = await readGranolaNote(run, summary.id);
  } catch (error) {
    return noteFailed(run, summary, failureOf(error));
  }
  run.tally.slowDownsInARow = 0;
  run.tally.offlineInARow = 0;
  if (read.tooLong) {
    settle(run, summary, 'refused', `Not imported: ${TRANSCRIPT_TOO_LONG}.`, read.note.web_url);
    return null;
  }
  try {
    await write(run, summary, read.note);
  } catch (error) {
    if (error instanceof ImportLedgerUnreadableError) throw error;
    // A write the vault refused (the disk, the sync gate): this note waits for the next import.
    const why = error instanceof Error ? error.message : String(error);
    settle(run, summary, 'failed', `It could not be written: ${why}`);
  }
  return null;
}

/**
 * Oldest change first, so an import cut short has taken in everything up to
 * where it stopped, and the next one carries on from there.
 */
function inDatedOrder(notes: readonly GranolaNoteSummary[]): GranolaNoteSummary[] {
  const at = (note: GranolaNoteSummary) => {
    const instant = Date.parse(note.updated_at);
    return Number.isNaN(instant) ? Infinity : instant;
  };
  return [...notes].sort((a, b) => at(a) - at(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Lists the notes and takes in each; how the import ended. */
async function importAll(run: Run, since: string | null): Promise<Ending> {
  let listing;
  try {
    listing = await listGranolaNotes(run, since);
  } catch (error) {
    const failure = failureOf(error);
    return { ended: 'failed', failure, problem: granolaFailureWords(failure, 'listing') };
  }
  for (const unreadable of listing.unreadable) {
    run.tally.counts.skipped += 1;
    run.tally.problems.push({
      ...{ id: unreadable.id ?? '', title: unreadable.id ?? 'A meeting', url: null },
      problem: `Granola listed it in a shape DFAI Lite cannot read: ${unreadable.reason}.`,
    });
  }
  for (const summary of inDatedOrder(listing.notes)) {
    const ending = await takeIn(run, summary);
    if (ending !== null) return ending;
  }
  return { ended: 'imported', failure: null, problem: null };
}

/** Runs the import, ended on the ledger when it cannot be read — at the start or along the way. */
async function importChecked(run: Run, since: string | null): Promise<Ending> {
  const parsed = readImportLedger(run.deps.vault.session);
  if (parsed.kind === 'malformed') return ledgerStop(parsed.reason);
  try {
    await queueWaitingMeetings(run.deps, parsed.ledger);
    return await importAll(run, since);
  } catch (error) {
    if (error instanceof ImportLedgerUnreadableError) return ledgerStop(error.message);
    throw error;
  }
}

/**
 * Imports Granola's meetings into the vault, once (DFAI's pull): lists the
 * notes since the watermark (every note for Import now), and for each one
 * the vault does not hold unchanged, oldest first, fetches it, maps it with
 * `fromGranola` and writes it — a new note at its contract path, or the
 * sections it lacks added to the note that holds it — recording it in the
 * import ledger. A meeting whose note the person deleted is not imported
 * again; with a ledger that cannot be read, nothing is. Each note it
 * creates gets a line in the meetings queue, for Claude to summarize. Never
 * rejects for Granola's failures: they are the report's.
 */
export async function importGranolaMeetings(
  deps: GranolaImportDeps,
  { mode, watermark }: { mode: GranolaPullMode; watermark: string | null },
): Promise<GranolaImportReport> {
  const tally: Tally = {
    results: [],
    written: [],
    problems: [],
    counts: { imported: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 },
    slowDownsInARow: 0,
    offlineInARow: 0,
  };
  const run: Run = {
    ...{ deps, tally, granola: deps.granola, vault: deps.vaultKey },
    send: pacedRequests({ clock: deps.clock, wait: deps.wait }),
    sources: sourcesIn(deps.vault),
  };
  const ending = await importChecked(run, sinceOf({ watermark, mode }));
  const next =
    ending.ended === 'imported'
      ? nextWatermark({ watermark, results: tally.results, now: deps.clock.now().getTime() })
      : watermark;
  return {
    ...{ mode, ended: ending.ended, counts: { ...tally.counts }, written: tally.written },
    ...{ problems: tally.problems, failure: ending.failure, problem: ending.problem },
    keyRefused: isKeyRefused(ending.failure),
    ledgerUnreadable: ending.ledgerUnreadable === true,
    watermark: next,
  };
}
