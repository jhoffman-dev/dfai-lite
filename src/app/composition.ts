import { systemClock } from '../adapters/clock/index.ts';
import { sampleVaultFiles } from '../adapters/memory/index.ts';
import { createLocalSettingsStore } from '../adapters/settings/index.ts';
import { isTauri } from '../adapters/tauri/index.ts';
import type { AppServices } from '../ui/services.ts';
import {
  createPendingEdits,
  deviceLayoutStorage,
  loadMarkdown,
  openSession,
  type Boot,
} from './app-boot.ts';
import { bootDesktop } from './desktop.ts';

export type { Boot } from './app-boot.ts';

/**
 * The Mac app on its vault folder, or, in a browser (`pnpm dev`, the e2e
 * smoke), the sample vault in memory with nothing to sync.
 */
export function boot(): Promise<Boot> {
  return isTauri() ? bootDesktop() : bootBrowser();
}

async function bootBrowser(): Promise<Boot> {
  const files = sampleVaultFiles();
  const { session, search } = await openSession(files);
  const services: AppServices = {
    files,
    session,
    search,
    settings: createLocalSettingsStore(window.localStorage),
    clock: systemClock,
    sync: null,
    desktop: null,
    pendingEdits: createPendingEdits(),
    loadMarkdown,
  };
  return { kind: 'app', services, layoutStorage: deviceLayoutStorage(), start: () => undefined };
}
