/**
 * When the vault syncs by itself, as DFAI does: a push about half a minute
 * after the vault last changed, at least every five minutes while changes
 * keep coming, and a look for other Macs' changes every minute.
 */
export const PUSH_DELAY_MS = 30_000;
export const MAX_UNSYNCED_MS = 5 * 60_000;
export const PULL_EVERY_MS = 60_000;

/**
 * How long from `now` until a push is due, after a change at `now`: the push
 * delay, cut short so that no change waits more than `maxUnsyncedMs` since
 * the first one not yet synced. Never negative.
 */
export function pushDueIn({
  now,
  firstUnsyncedAt,
  pushDelayMs = PUSH_DELAY_MS,
  maxUnsyncedMs = MAX_UNSYNCED_MS,
}: {
  now: number;
  /** When the oldest change not yet synced was made; null when this one is the first. */
  firstUnsyncedAt: number | null;
  pushDelayMs?: number;
  maxUnsyncedMs?: number;
}): number {
  const first = firstUnsyncedAt ?? now;
  // A clock set back puts the first change in the future: wait the usual delay.
  const waited = Math.max(0, now - first);
  return Math.max(0, Math.min(pushDelayMs, maxUnsyncedMs - waited));
}
