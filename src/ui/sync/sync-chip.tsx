import { useSyncExternalStore } from 'react';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import type { SyncControls, SyncStatus } from './sync-status.ts';
import './sync.css';

const timeOf = (moment: Date) =>
  moment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The words a status is said in, and the tone of the sync light's dot (DFAI's tones). */
export function describeSyncStatus(status: SyncStatus): { label: string; tone: string } {
  switch (status.kind) {
    case 'idle':
      return status.lastSyncedAt === null
        ? { label: 'Not synced yet', tone: 'paused' }
        : { label: `Synced ${timeOf(status.lastSyncedAt)}`, tone: 'ok' };
    case 'syncing':
      return { label: 'Syncing…', tone: 'busy' };
    case 'offline':
      return { label: 'Offline', tone: 'paused' };
    case 'needs-sign-in':
      return { label: 'Needs sign-in', tone: 'error' };
    case 'off':
      return { label: 'Sync off', tone: 'paused' };
    case 'blocked':
      return { label: 'Sync paused', tone: 'error' };
    case 'needs-confirmation':
      return { label: `${status.count} missing`, tone: 'warning' };
    case 'error':
      return { label: 'Sync stopped', tone: 'error' };
    case 'conflicts':
      return {
        label: status.count === 1 ? '1 conflict' : `${status.count} conflicts`,
        tone: 'warning',
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
 * The sidebar footer's sync light, DFAI's: a cloud with a dot in the status's
 * tone, its words on hover. Clicking it syncs now, or,
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
      className={`sync-indicator sync-indicator--${tone}`}
      aria-label={`Sync status: ${label}. ${asks ? 'Open Settings' : 'Sync now'}`}
      title={[label, syncStatusDetail(status)].filter((line) => line !== null).join(' — ')}
      disabled={status.kind === 'syncing'}
      onClick={() => (asks ? ui.setState({ settingsOpen: true }) : sync.syncNow())}
    >
      <Icon name="cloud" size={16} />
      <span className="sync-indicator__dot" aria-hidden="true" />
    </button>
  );
}
