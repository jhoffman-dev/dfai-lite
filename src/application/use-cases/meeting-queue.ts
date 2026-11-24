import {
  MEETING_QUEUE_PATH,
  queueMeetings,
  type QueuedMeeting,
} from '../../domain/meetings/index.ts';
import { FileChangedError, FileExistsError } from '../ports/index.ts';
import { refreshPaths, writeFile, type VaultDeps } from './vault-deps.ts';

/**
 * Adds a line to the meetings queue for each meeting it does not list yet,
 * through the guarded write. A queue changed on disk meanwhile (Claude
 * taking a line out, a sync bringing the other Mac's) is read again once and
 * added to, so neither side's lines are lost.
 */
export async function addToMeetingQueue(
  deps: VaultDeps,
  meetings: readonly QueuedMeeting[],
  retried = false,
): Promise<void> {
  const current = deps.session.file(MEETING_QUEUE_PATH)?.text ?? null;
  const next = queueMeetings(current, meetings);
  if (next === current) return;
  try {
    await writeFile(deps, MEETING_QUEUE_PATH, next);
  } catch (error) {
    const changed = error instanceof FileChangedError || error instanceof FileExistsError;
    if (retried || !changed) throw error;
    await refreshPaths(deps, [MEETING_QUEUE_PATH]);
    await addToMeetingQueue(deps, meetings, true);
  }
}
