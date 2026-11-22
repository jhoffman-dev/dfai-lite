/*
 * Where an import of Granola starts listing notes (`updated_after`), and
 * where the next one will, lifted from DFAI. The watermark is this Mac's;
 * losing it costs one full listing, which is cheap: notes the vault already
 * holds unchanged are never fetched. Granola documents no order for its
 * list, so the next watermark is decided only once every page has been read.
 */

const HOUR_MS = 60 * 60_000;

/** How much an import lists again before its watermark, so a note on the edge is never missed. */
export const WATERMARK_OVERLAP_MS = 24 * HOUR_MS;

/** An import when the vault opens, one on the 15-minute timer, or the person pressing Import now. */
export type GranolaPullMode = 'startup' | 'periodic' | 'import-now';

/** An instant as milliseconds, or null when it is not one. */
function instantOf(text: string | null): number | null {
  // Not trusted to be text: a watermark is read back from where this Mac kept it.
  if (typeof text !== 'string') return null;
  const instant = Date.parse(text);
  return Number.isNaN(instant) ? null : instant;
}

/** The earliest or latest of the instants known, taken pairwise; null when none is. */
function extreme(
  pick: (a: number, b: number) => number,
  instants: readonly (number | null)[],
): number | null {
  let found: number | null = null;
  for (const instant of instants) {
    if (instant !== null) found = found === null ? instant : pick(found, instant);
  }
  return found;
}

/** The instant as RFC 3339; null when there is none, or it is past the range a date can hold. */
function isoOf(instant: number | null): string | null {
  if (instant === null) return null;
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The `updated_after` for an import: a day before the watermark at startup
 * and on the timer. Null — list every note — for Import now, for a first
 * import, and for a watermark that cannot be read.
 */
export function sinceOf({
  watermark,
  mode,
}: {
  readonly watermark: string | null;
  readonly mode: GranolaPullMode;
}): string | null {
  const mark = mode === 'import-now' ? null : instantOf(watermark);
  return isoOf(mark === null ? null : mark - WATERMARK_OVERLAP_MS);
}

/**
 * What became of one listed note. `imported`, `updated` and `unchanged` are
 * settled; so are `refused` (the mapper said no) and `skipped` (a failure
 * that would come back the same on every import, or a meeting the person
 * deleted). `failed` may pass by itself — network, timeout, 429 past its
 * retries, a 5xx — and must be listed again.
 */
export type GranolaNoteOutcome =
  'imported' | 'updated' | 'unchanged' | 'refused' | 'skipped' | 'failed';

export interface GranolaNoteResult {
  readonly outcome: GranolaNoteOutcome;
  /** The note's `updated_at`, as Granola listed it. */
  readonly updatedAt: string;
}

/** The instant, or `now` when it is later; none stays none. */
const notPast = (instant: number | null, now: number) =>
  instant === null ? null : Math.min(instant, now);

/**
 * The watermark after an import: the newest settled note's `updated_at`
 * (never behind the watermark it started from), but never past the oldest
 * `failed` note, so the next import lists that one again. A failed note
 * whose time cannot be read keeps the watermark where it was. Never past
 * `now`: one note stamped in the future would otherwise carry it there.
 */
export function nextWatermark({
  watermark,
  results,
  now,
}: {
  readonly watermark: string | null;
  readonly results: readonly GranolaNoteResult[];
  /** Now, in milliseconds since the epoch, by the injected clock. */
  readonly now: number;
}): string | null {
  const current = instantOf(watermark);
  const failedAt = results
    .filter((result) => result.outcome === 'failed')
    .map((result) => instantOf(result.updatedAt));
  if (failedAt.includes(null)) return isoOf(notPast(current, now));
  const settledAt = results
    .filter((result) => result.outcome !== 'failed')
    .map((result) => instantOf(result.updatedAt));
  const reached = extreme(Math.max, [current, extreme(Math.max, settledAt)]);
  return isoOf(notPast(extreme(Math.min, [reached, extreme(Math.min, failedAt)]), now));
}
