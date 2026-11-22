import {
  granolaFailureEffect,
  granolaFailureWords,
  isKeyRefused,
  nextWatermark,
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
  MeetingInputError,
  recordImport,
  type ImportLedger,
} from '../../domain/meetings/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import type { Clock } from '../ports/index.ts';
import { readImportLedger, writeImportLedger, type VaultDeps } from '../use-cases/index.ts';
import { listGranolaNotes, readGranolaNote, type GranolaReader } from './granola-reading.ts';
import { isSlowDown, pacedRequests, type Wait } from './granola-requests.ts';
import { placeMeeting, sourcesIn } from './place-meeting.ts';
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
  ledger: ImportLedger;
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
}

const COUNTED: Readonly<Record<GranolaNoteOutcome, keyof GranolaCounts>> = {
  imported: 'imported',
  updated: 'updated',
  unchanged: 'unchanged',
  refused: 'skipped',
  skipped: 'skipped',
  failed: 'failed',
};

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

/** A note Granola would not give: left for the next import, skipped, or the end of the import. */
function noteFailed(run: Run, summary: GranolaNoteSummary, failure: GranolaFailure): Ending | null {
  const effect = granolaFailureEffect(failure);
  if (effect === 'stop') {
    return { ended: 'stopped', failure, problem: granolaFailureWords(failure) };
  }
  settle(run, summary, effect === 'retry' ? 'failed' : 'skipped', granolaFailureWords(failure));
  run.tally.slowDownsInARow = isSlowDown(failure) ? run.tally.slowDownsInARow + 1 : 0;
  if (run.tally.slowDownsInARow < SLOW_DOWNS_IN_A_ROW) return null;
  return { ended: 'failed', failure, problem: granolaFailureWords(failure) };
}

/** Records where the meeting is now, in the ledger and on disk. */
async function remember(
  run: Run,
  summary: GranolaNoteSummary,
  path: VaultPath,
  source: string | null,
) {
  run.tally.ledger = recordImport(run.tally.ledger, {
    provider: PROVIDER,
    id: summary.id,
    path,
    source,
    updatedAt: summary.updated_at,
    dismissed: false,
  });
  await writeImportLedger(run.deps.vault, run.tally.ledger);
}

/**
 * What the ledger already says, before anything is fetched: a meeting the
 * person deleted is skipped (its note gone, and no note carrying its source);
 * one whose note is there and that Granola has not changed since is
 * unchanged. False to fetch it.
 */
async function settledByLedger(run: Run, summary: GranolaNoteSummary): Promise<boolean> {
  const entry = findImport(run.tally.ledger, { provider: PROVIDER, id: summary.id });
  if (entry === null) return false;
  if (entry.dismissed) {
    settle(run, summary, 'skipped');
    return true;
  }
  const { session } = run.deps.vault;
  const movedTo = entry.source === null ? undefined : run.sources.get(entry.source);
  const path = session.file(entry.path) !== null ? entry.path : movedTo;
  if (path === undefined) {
    run.tally.ledger = recordImport(run.tally.ledger, { ...entry, dismissed: true });
    await writeImportLedger(run.deps.vault, run.tally.ledger);
    settle(run, summary, 'skipped');
    return true;
  }
  if (entry.updatedAt !== summary.updated_at) return false;
  if (path !== entry.path) await remember(run, summary, path, entry.source);
  settle(run, summary, 'unchanged');
  return true;
}

/** Maps the note and puts it in the vault; refused by name when the mapper cannot read it. */
async function write(run: Run, summary: GranolaNoteSummary, note: GranolaNote): Promise<void> {
  const { deps, tally } = run;
  let input;
  try {
    input = fromGranola(note, { timeZone: deps.timeZone, selfEmails: deps.selfEmails });
  } catch (error) {
    if (!(error instanceof MeetingInputError)) throw error;
    const problem = `Granola’s note could not be read: ${error.message}.`;
    settle(run, summary, 'refused', problem, note.web_url);
    return;
  }
  const found = findImport(tally.ledger, { provider: PROVIDER, id: summary.id });
  const entry = found === null || found.dismissed ? null : found;
  const placed = await placeMeeting(deps.vault, {
    ...{ provider: PROVIDER, id: summary.id, input, entry },
    ...{ ledger: tally.ledger, sources: run.sources },
  });
  if (placed.outcome !== 'unchanged') tally.written.push(placed.path);
  if (input.sourceUrl !== undefined) run.sources.set(input.sourceUrl, placed.path);
  await remember(run, summary, placed.path, input.sourceUrl ?? null);
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
  if (read.tooLong) {
    settle(run, summary, 'refused', `Not imported: ${TRANSCRIPT_TOO_LONG}.`, read.note.web_url);
    return null;
  }
  try {
    await write(run, summary, read.note);
  } catch (error) {
    // A write the vault refused (the disk, the sync gate): this note waits for the next import.
    const why = error instanceof Error ? error.message : String(error);
    settle(run, summary, 'failed', `It could not be written: ${why}`);
  }
  return null;
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
  for (const summary of listing.notes) {
    const ending = await takeIn(run, summary);
    if (ending !== null) return ending;
  }
  return { ended: 'imported', failure: null, problem: null };
}

/**
 * Imports Granola's meetings into the vault, once (DFAI's pull): lists the
 * notes since the watermark (every note for Import now), and for each one
 * the vault does not hold unchanged, fetches it, maps it with `fromGranola`
 * and writes it — a new note at its contract path, or the sections it lacks
 * added to the note that holds it — recording it in the import ledger. A
 * meeting whose note the person deleted is not imported again. Never
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
    ledger: readImportLedger(deps.vault.session).ledger,
  };
  const run: Run = {
    ...{ deps, tally, granola: deps.granola, vault: deps.vaultKey },
    send: pacedRequests({ clock: deps.clock, wait: deps.wait }),
    sources: sourcesIn(deps.vault),
  };
  const ending = await importAll(run, sinceOf({ watermark, mode }));
  const next =
    ending.ended === 'imported'
      ? nextWatermark({ watermark, results: tally.results, now: deps.clock.now().getTime() })
      : watermark;
  return {
    ...{ mode, ended: ending.ended, counts: { ...tally.counts }, written: tally.written },
    ...{ problems: tally.problems, failure: ending.failure, problem: ending.problem },
    keyRefused: isKeyRefused(ending.failure),
    watermark: next,
  };
}
