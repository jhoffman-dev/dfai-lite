/*
 * What one import did, in a few words for Settings and the notice: DFAI's
 * pull report, counted the way Lite merges rather than skips.
 */

/** How many listed meetings came to each end. */
export interface GranolaCounts {
  /** New meeting notes written. */
  readonly imported: number;
  /** Notes already in the vault that gained a section (a transcript that came later). */
  readonly updated: number;
  /** Notes already in the vault with nothing new. */
  readonly unchanged: number;
  /** Meetings refused, skipped or deleted by the person: not written, and not retried by themselves. */
  readonly skipped: number;
  /** Meetings that failed in a way that may pass: the next import lists them again. */
  readonly failed: number;
}

/** How an import ended. `not-synced`: sync had not pulled the vault yet, so nothing was asked. */
export type GranolaPullEnd = 'imported' | 'stopped' | 'failed' | 'not-synced';

const meetings = (count: number) => (count === 1 ? '1 meeting' : `${count} meetings`);

/** The counts as a line: `Imported 2 meetings, updated 1; 14 already here.` */
export function granolaCountsLine(counts: GranolaCounts): string {
  const done = [
    counts.imported > 0 ? `imported ${meetings(counts.imported)}` : null,
    counts.updated > 0 ? `updated ${meetings(counts.updated)}` : null,
  ].filter((part) => part !== null);
  const left = [
    counts.unchanged > 0 ? `${counts.unchanged} already here` : null,
    counts.skipped > 0 ? `${counts.skipped} skipped` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
  ].filter((part) => part !== null);
  const head = done.length === 0 ? 'Nothing new' : done.join(', ');
  const sentence = left.length === 0 ? head : `${head}; ${left.join(', ')}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** The line Settings shows for an import that ended. */
export function granolaReportLine({
  ended,
  counts,
  problem,
}: {
  readonly ended: GranolaPullEnd;
  readonly counts: GranolaCounts;
  readonly problem: string | null;
}): string {
  if (ended === 'not-synced') return 'Waiting for the vault to sync first.';
  const line = granolaCountsLine(counts);
  return problem === null ? line : `${line} ${problem}`;
}

/** The quiet notice when meetings arrive; null when none did. */
export function granolaArrivalNotice(counts: GranolaCounts): string | null {
  if (counts.imported === 0) return null;
  return counts.imported === 1
    ? 'A meeting arrived from Granola.'
    : `${counts.imported} meetings arrived from Granola.`;
}
