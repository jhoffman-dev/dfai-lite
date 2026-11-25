import { APP_FOLDER, pathAfterMove, type PathMove, type VaultPath } from '../vault/index.ts';

/*
 * The import ledger: which provider meeting became which note. DFAI keeps a
 * meeting's `provider` and `external_id` in its frontmatter; a Lite note has
 * none, so the vault keeps them beside the notes, in one synced file the way
 * the favorites are kept. A note's own `- Source:` line is the backstop: the
 * ledger can be rebuilt from the notes when it is lost or a sync conflict
 * kept the other Mac's copy.
 */

/** Where the ledger lives: an ordinary vault file, synced like a note. */
export const IMPORTS_PATH = `${APP_FOLDER}/imports.json`;

const VERSION = 1;

/** One meeting a provider sent, and the note it is. */
export interface ImportEntry {
  /** `granola`. */
  readonly provider: string;
  /** The provider's own id for the meeting (`not_…`). */
  readonly id: string;
  /** The note it was written to, as it is now (renames and moves follow it). */
  readonly path: VaultPath;
  /** The meeting in the provider's app, as the note's `- Source:` line says; null with none. */
  readonly source: string | null;
  /** The provider's `updated_at` when the note last took the meeting in: unchanged since means nothing to fetch. */
  readonly updatedAt: string;
  /** The person deleted the note: the meeting is not imported again unless they ask. */
  readonly dismissed: boolean;
  /**
   * The note was new, and its line has not reached the meetings queue yet
   * (the queue's write failed): the next import puts it there. Absent once
   * it has, or for a note that was never new.
   */
  readonly queueWaiting?: true;
}

/** Every entry, each provider and id once, sorted by provider then id. */
export type ImportLedger = readonly ImportEntry[];

export type ParsedImportLedger =
  | { readonly kind: 'ok'; readonly ledger: ImportLedger }
  | { readonly kind: 'malformed'; readonly ledger: ImportLedger; readonly reason: string };

type Fields = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

function entryOf(value: unknown): ImportEntry | null {
  if (!isRecord(value)) return null;
  const provider = text(value.provider);
  const id = text(value.id);
  const path = text(value.path);
  const updatedAt = text(value.updatedAt);
  if (provider === null || id === null || path === null || updatedAt === null) return null;
  return {
    provider,
    id,
    path,
    source: text(value.source),
    updatedAt,
    dismissed: value.dismissed === true,
    ...(value.queueWaiting === true ? { queueWaiting: true } : {}),
  };
}

const keyOf = ({ provider, id }: Pick<ImportEntry, 'provider' | 'id'>) => `${provider}\n${id}`;

/** By provider, then id, by code unit: the same on every Mac, whatever its locale. */
function order(left: ImportEntry, right: ImportEntry): number {
  const [a, b] = [keyOf(left), keyOf(right)];
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The entries sorted, each provider and id once (the last one given winning). */
function settled(entries: Iterable<ImportEntry>): ImportLedger {
  const byKey = new Map<string, ImportEntry>();
  for (const entry of entries) byKey.set(keyOf(entry), entry);
  return [...byKey.values()].sort(order);
}

/**
 * The ledger from the file's text. Tolerant: an entry that is not one is
 * left out and the rest kept; text that is not the ledger at all reads as
 * empty and says why, and the notes' `- Source:` lines stand in for it.
 */
export function parseImportLedger(source: string): ParsedImportLedger {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    // The text is not JSON; that is exactly what `malformed` reports.
    return { kind: 'malformed', ledger: [], reason: `${IMPORTS_PATH} is not valid JSON.` };
  }
  const meetings = isRecord(value) ? value.meetings : undefined;
  if (!Array.isArray(meetings)) {
    return { kind: 'malformed', ledger: [], reason: `${IMPORTS_PATH} lists no meetings.` };
  }
  const entries = meetings.map(entryOf).filter((entry) => entry !== null);
  return { kind: 'ok', ledger: settled(entries) };
}

/** The file's text: the same ledger always gives the same bytes, keys in a fixed order. */
export function serializeImportLedger(ledger: ImportLedger): string {
  const meetings = settled(ledger).map((entry) => ({
    provider: entry.provider,
    id: entry.id,
    path: entry.path,
    source: entry.source,
    updatedAt: entry.updatedAt,
    ...(entry.dismissed ? { dismissed: true } : {}),
    ...(entry.queueWaiting === true ? { queueWaiting: true } : {}),
  }));
  return `${JSON.stringify({ version: VERSION, meetings }, null, 2)}\n`;
}

export function findImport(
  ledger: ImportLedger,
  { provider, id }: Pick<ImportEntry, 'provider' | 'id'>,
): ImportEntry | null {
  return ledger.find((entry) => entry.provider === provider && entry.id === id) ?? null;
}

/** The meeting a note holds, by its path: never a dismissed one, whose note is gone. */
export function importAtPath(ledger: ImportLedger, path: VaultPath): ImportEntry | null {
  return ledger.find((entry) => !entry.dismissed && entry.path === path) ?? null;
}

/** The ledger with `entry` in it, replacing the one for its provider and id. */
export function recordImport(ledger: ImportLedger, entry: ImportEntry): ImportLedger {
  return settled([...ledger, entry]);
}

/** The ledger after a note or folder moved: each meeting moved follows its note. */
export function ledgerAfterMove(ledger: ImportLedger, move: PathMove): ImportLedger {
  return ledger.map((entry) => {
    const moved = entry.dismissed ? null : pathAfterMove(entry.path, move);
    return moved === null ? entry : { ...entry, path: moved };
  });
}

/** The ledger after a note was deleted: the meeting it held is dismissed, never imported again by itself. */
export function ledgerAfterDelete(ledger: ImportLedger, path: VaultPath): ImportLedger {
  return ledger.map((entry) =>
    !entry.dismissed && entry.path === path ? { ...entry, dismissed: true } : entry,
  );
}

/**
 * The ledger without the meetings of `provider` the person deleted: their
 * notes are gone, so the next import takes them in afresh, as new meetings.
 */
export function restoreDismissed(ledger: ImportLedger, provider: string): ImportLedger {
  return ledger.filter((entry) => !(entry.dismissed && entry.provider === provider));
}

/** The entry with its queue line waiting, or not: only a waiting entry carries the field. */
export function withQueueWaiting(entry: ImportEntry, waiting: boolean): ImportEntry {
  const { provider, id, path, source, updatedAt, dismissed } = entry;
  const plain: ImportEntry = { provider, id, path, source, updatedAt, dismissed };
  return waiting ? { ...plain, queueWaiting: true } : plain;
}

/** The meetings whose queue line is still to be written, and whose note is still theirs. */
export const awaitingQueue = (ledger: ImportLedger): ImportEntry[] =>
  ledger.filter((entry) => entry.queueWaiting === true && !entry.dismissed);

/** Whether two ledgers say the same: what decides that the file needs no write. */
export const sameLedger = (left: ImportLedger, right: ImportLedger): boolean =>
  serializeImportLedger(left) === serializeImportLedger(right);
