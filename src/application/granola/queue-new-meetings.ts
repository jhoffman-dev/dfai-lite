import {
  awaitingQueue,
  wallClockIn,
  withQueueWaiting,
  type ImportEntry,
  type ImportLedger,
} from '../../domain/meetings/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import type { Clock } from '../ports/index.ts';
import {
  addToMeetingQueue,
  ImportLedgerUnreadableError,
  updateImportLedger,
  type VaultDeps,
} from '../use-cases/index.ts';

/** What queuing a meeting for Claude needs: the vault, and the day it is in the person's zone. */
export interface QueueDeps {
  readonly vault: VaultDeps;
  readonly clock: Clock;
  readonly timeZone: string;
}

const today = ({ clock, timeZone }: QueueDeps): string =>
  wallClockIn(timeZone)(clock.now().getTime()).day;

/** Puts the notes' lines in the queue; false when it could not be written. */
async function queued(deps: QueueDeps, paths: readonly VaultPath[]): Promise<boolean> {
  try {
    const added = today(deps);
    await addToMeetingQueue(
      deps.vault,
      paths.map((path) => ({ path, added })),
    );
    return true;
  } catch (error) {
    // The queue could not be written (the disk, the sync gate, a queue that kept
    // changing). The meeting is in the vault all the same, so the import goes on;
    // the ledger keeps the note waiting and the next import writes its line.
    if (error instanceof Error) return false;
    throw error;
  }
}

/** Queues a note the import just wrote for the first time; false when the line must wait. */
export const queueNewMeeting = (deps: QueueDeps, path: VaultPath): Promise<boolean> =>
  queued(deps, [path]);

const sameMeeting = (left: ImportEntry, right: ImportEntry) =>
  left.provider === right.provider && left.id === right.id;

/**
 * Writes the queue lines an earlier import could not, for the notes that are
 * still there, and marks them done in the ledger. Left waiting when the
 * queue still cannot be written.
 */
export async function queueWaitingMeetings(deps: QueueDeps, ledger: ImportLedger): Promise<void> {
  const waiting = awaitingQueue(ledger).filter(
    ({ path }) => deps.vault.session.file(path) !== null,
  );
  if (waiting.length === 0) return;
  const paths = waiting.map(({ path }) => path);
  if (!(await queued(deps, paths))) return;
  try {
    await updateImportLedger(deps.vault, (now) =>
      now.map((entry) =>
        waiting.some((done) => sameMeeting(done, entry)) ? withQueueWaiting(entry, false) : entry,
      ),
    );
  } catch (error) {
    if (error instanceof ImportLedgerUnreadableError || !(error instanceof Error)) throw error;
    // The lines are in the queue; only the ledger still says they wait. The
    // next import finds them listed (nothing written twice) and clears them then.
  }
}
