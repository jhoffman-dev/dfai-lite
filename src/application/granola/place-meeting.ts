import {
  importAtPath,
  meetingCopyPath,
  meetingPath,
  meetingSourceOf,
  meetingWrite,
  type ImportEntry,
  type ImportLedger,
  type MeetingInput,
  type TranscriptNote,
} from '../../domain/meetings/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { FileChangedError, FileExistsError } from '../ports/index.ts';
import { refreshPaths, writeFile, type VaultDeps } from '../use-cases/index.ts';

/** Where a provider's meeting went: a new note, a note that gained a section, or one with nothing new. */
export interface Placed {
  readonly path: VaultPath;
  readonly outcome: 'imported' | 'updated' | 'unchanged';
}

/** One meeting to place, with what the vault already says of it. */
export interface Placing {
  readonly provider: string;
  readonly id: string;
  readonly input: MeetingInput;
  /** Its ledger entry, when it has one that is not dismissed. */
  readonly entry: ImportEntry | null;
  readonly ledger: ImportLedger;
  /** Each note's `- Source:` address, to the note: how a meeting the ledger lost is found. */
  readonly sources: ReadonlyMap<string, VaultPath>;
}

/**
 * The note that holds the meeting, if any: its ledger entry's note, else a
 * note whose `- Source:` line is the meeting's own address.
 */
function heldAt(deps: VaultDeps, { entry, input, sources }: Placing): VaultPath | null {
  if (entry !== null && deps.session.file(entry.path) !== null) return entry.path;
  const source = input.sourceUrl === undefined ? undefined : sources.get(input.sourceUrl);
  return source ?? null;
}

/**
 * Where a meeting with no note yet goes: its plain path, unless another
 * meeting from the same provider holds that — two `1:1`s on one day — when
 * it goes to DFAI's copy path. A note there from elsewhere (n8n's Gemini
 * note, one typed by hand) is the same meeting by the vault contract, and is
 * added to.
 */
function targetOf(deps: VaultDeps, placing: Placing): VaultPath {
  const plain = meetingPath(placing.input);
  const holder = importAtPath(placing.ledger, plain);
  const inLedger = holder !== null && holder.provider === placing.provider;
  const other = inLedger
    ? holder.id !== placing.id
    : sameSiteOtherMeeting(deps.session.file(plain)?.text ?? null, placing.input.sourceUrl);
  return other ? meetingCopyPath(placing.input, placing) : plain;
}

const siteOf = (address: string): string | null => {
  try {
    return new URL(address).host;
  } catch {
    // Not an address at all: it names no site.
    return null;
  }
};

/**
 * Whether a note the ledger does not know holds another meeting from the
 * same provider: its `- Source:` is on the same site as this meeting's, but
 * is not this meeting's. How a lost ledger still keeps two `1:1`s apart.
 */
function sameSiteOtherMeeting(text: string | null, source: string | undefined): boolean {
  const theirs = text === null ? null : meetingSourceOf(text);
  if (theirs === null || source === undefined || theirs === source) return false;
  const site = siteOf(source);
  return site !== null && siteOf(theirs) === site;
}

/**
 * Creates the transcript note a meeting note is about to link, before the
 * link is written, so a link never points at nothing because a write failed
 * between the two. A transcript note already there is this meeting's (the
 * name says so), from an earlier import that stopped before its link: it is
 * kept, never written over.
 */
async function createTranscript(deps: VaultDeps, transcript: TranscriptNote | null): Promise<void> {
  if (transcript === null || deps.session.file(transcript.path) !== null) return;
  try {
    await writeFile(deps, transcript.path, transcript.text);
  } catch (error) {
    if (!(error instanceof FileExistsError)) throw error;
    // Reached the disk meanwhile (the other Mac's import, just synced in): same meeting, same transcript.
    await refreshPaths(deps, [transcript.path]);
  }
}

/** Adds the sections the note lacks; nothing a person wrote is changed. A note changed meanwhile is read again once. */
async function mergeInto(
  deps: VaultDeps,
  path: VaultPath,
  input: MeetingInput,
  retried = false,
): Promise<Placed> {
  const existing = deps.session.file(path)?.text ?? '';
  const { text: merged, transcript } = meetingWrite(existing, input, path);
  if (merged === existing) return { path, outcome: 'unchanged' };
  await createTranscript(deps, transcript);
  try {
    await writeFile(deps, path, merged);
  } catch (error) {
    if (retried || !(error instanceof FileChangedError)) throw error;
    await refreshPaths(deps, [path]);
    return mergeInto(deps, path, input, true);
  }
  return { path, outcome: 'updated' };
}

/**
 * Writes a new note, never over one: a note that reached the disk meanwhile
 * (the other Mac's, just synced in) is the same meeting, and is merged into.
 */
async function create(deps: VaultDeps, path: VaultPath, input: MeetingInput): Promise<Placed> {
  const { text, transcript } = meetingWrite('', input, path);
  await createTranscript(deps, transcript);
  try {
    await writeFile(deps, path, text);
    return { path, outcome: 'imported' };
  } catch (error) {
    if (!(error instanceof FileExistsError)) throw error;
    await refreshPaths(deps, [path]);
    return mergeInto(deps, path, input);
  }
}

/** Puts the meeting in the vault: merged into the note that holds it, else written as a new one. */
export async function placeMeeting(deps: VaultDeps, placing: Placing): Promise<Placed> {
  const held = heldAt(deps, placing) ?? targetOf(deps, placing);
  if (deps.session.file(held) !== null) return mergeInto(deps, held, placing.input);
  return create(deps, held, placing.input);
}

/** Every note's `- Source:` address, to its path: read once per import. */
export function sourcesIn(deps: VaultDeps): Map<string, VaultPath> {
  const sources = new Map<string, VaultPath>();
  for (const { path, text } of deps.session.allFiles()) {
    if (!path.endsWith('.md')) continue;
    const source = meetingSourceOf(text);
    if (source !== null && !sources.has(source)) sources.set(source, path);
  }
  return sources;
}
