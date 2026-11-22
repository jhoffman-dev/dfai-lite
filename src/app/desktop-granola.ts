import {
  createGranolaImporter,
  type GranolaControls,
  type SettingsStore,
  type SyncReadiness,
  type VaultDeps,
} from '../application/index.ts';
import { systemClock, systemTimeZone, systemTimers } from '../adapters/clock/index.ts';
import { createGranolaRecords } from '../adapters/granola-records/index.ts';
import { tauriGranola } from '../adapters/tauri/index.ts';
import type { SyncControls, SyncStatus } from '../ui/sync/sync-status.ts';

/**
 * Whether a sync has pulled the vault this session: one finished, with or
 * without conflict copies — `lastSyncedAt` is set only by a sync that ran in
 * this session, whatever the status shows, so conflict copies left from an
 * earlier session do not count — or it found the vault does not sync, the
 * one case with nothing to pull. Once true it stays true for the session,
 * as DFAI's `syncedThisSession`.
 */
function pulledThisSession(status: SyncStatus): boolean {
  if (status.kind === 'off') return true;
  return 'lastSyncedAt' in status && status.lastSyncedAt !== null;
}

export function syncReadiness(sync: SyncControls): SyncReadiness {
  let ready = pulledThisSession(sync.getStatus());
  return {
    isReady: () => ready,
    subscribe(listener) {
      return sync.subscribe(() => {
        if (ready || !pulledThisSession(sync.getStatus())) return;
        ready = true;
        listener();
      });
    },
  };
}

/**
 * Granola, for the open vault: the host's key and API, this Mac's record in
 * its settings file, the vault's writes behind sync's gate. `me` is written
 * as the meeting owner's name: Lite keeps no list of the person's addresses.
 */
export function wireGranola({
  deps,
  sync,
  settings,
  vaultPath,
}: {
  deps: VaultDeps;
  sync: SyncControls;
  settings: SettingsStore;
  vaultPath: string;
}): GranolaControls & { start(): void } {
  return createGranolaImporter({
    granola: tauriGranola,
    records: createGranolaRecords(settings),
    vault: deps,
    vaultKey: vaultPath,
    clock: systemClock,
    timers: systemTimers,
    timeZone: systemTimeZone(),
    selfEmails: [],
    sync: syncReadiness(sync),
  });
}
