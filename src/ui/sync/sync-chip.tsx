import { useSyncExternalStore } from 'react';
import { useApp } from '../services.ts';
import type { SyncControls, SyncStatus } from './sync-status.ts';
import './sync.css';

const timeOf = (moment: Date) =>
  moment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The words and the pastel a status is shown in. */
export function describeSyncStatus(status: SyncStatus): { label: string; tone: string } {
  switch (status.kind) {
    case 'idle':
      return status.lastSyncedAt === null
        ? { label: 'Not synced yet', tone: 'gray' }
        : { label: `Synced ${timeOf(status.lastSyncedAt)}`, tone: 'green' };
    case 'syncing':
      return { label: 'Syncing…', tone: 'blue' };
    case 'offline':
      return { label: 'Offline', tone: 'gray' };
    case 'needs-sign-in':
      return { label: 'Needs sign-in', tone: 'red' };
    case 'off':
      return { label: 'Sync off', tone: 'gray' };
    case 'blocked':
      return { label: 'Sync paused', tone: 'red' };
    case 'needs-confirmation':
      return { label: `${status.count} missing`, tone: 'orange' };
    case 'error':
      return { label: 'Sync stopped', tone: 'red' };
    case 'conflicts':
      return {
        label: status.count === 1 ? '1 conflict' : `${status.count} conflicts`,
        tone: 'orange',
      };
  }
}

/** Why sync stands where it does, in a sentence, when there is more to say than the label. */
export function syncStatusDetail(status: SyncStatus): string | null {
  switch (status.kind) {
    case 'error':
    case 'off':
    case 'blocked':
    case 'needs-confirmation':
      return status.message;
    case 'idle':
      return status.notice ?? null;
    default:
      return null;
  }
}

/**
 * The sidebar footer's chip: where sync stands. Clicking it syncs now, or,
 * when sync waits for a yes, opens Settings where the question is.
 */
export function SyncChip({ sync }: { sync: SyncControls }) {
  const { ui } = useApp();
  const status = useSyncExternalStore(sync.subscribe, sync.getStatus);
  const { label, tone } = describeSyncStatus(status);
  const asks = status.kind === 'needs-confirmation';
  return (
    <button
      type="button"
      className={`sync-chip tone-${tone}`}
      aria-label={`Sync status: ${label}. ${asks ? 'Open Settings' : 'Sync now'}`}
      title={syncStatusDetail(status) ?? undefined}
      disabled={status.kind === 'syncing'}
      onClick={() => (asks ? ui.setState({ settingsOpen: true }) : sync.syncNow())}
    >
      {label}
    </button>
  );
}
