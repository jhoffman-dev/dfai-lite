import {
  applyExternalChanges,
  createWriteGate,
  gatedVaultFiles,
  type SettingsStore,
  type VaultDeps,
  type VaultFiles,
} from '../application/index.ts';
import { systemClock, systemTimers } from '../adapters/clock/index.ts';
import { webviewImageProbe } from '../adapters/image-probe/index.ts';
import { createFileSettingsStore } from '../adapters/settings/index.ts';
import {
  askYesNo,
  bringWindowForward,
  openTauriVaultFiles,
  pickFolder,
  readSettingsText,
  setGlobalShortcut,
  setWindowTheme,
  tauriGit,
  writeSettingsText,
} from '../adapters/tauri/index.ts';
import { navigate } from '../ui/routing/use-route.ts';
import { browserThemeParts } from '../ui/theme/browser-theme.ts';
import { createThemeController, type ThemeChoice } from '../ui/theme/theme.ts';
import type { AppServices } from '../ui/services.ts';
import type { DesktopControls } from '../ui/settings/desktop-controls.ts';
import {
  createPendingEdits,
  deviceLayoutStorage,
  loadMarkdown,
  openSession,
  type Boot,
} from './app-boot.ts';
import { wireGranola } from './desktop-granola.ts';
import { remoteInfo, wireSync } from './desktop-sync.ts';

type FileSettings = SettingsStore & { written(): Promise<void> };

/** Nothing on screen to tell yet (a settings write, a key at start): the console keeps it. */
const reportQuietly = (what: string) => (error: unknown) =>
  console.error(`DFAI Lite could not ${what}:`, error);

/**
 * The Mac app: this Mac's settings from the app's config folder, then the
 * vault folder they name (read whole, in one call) or, with none yet, the
 * first-start question. Git, the watcher's first batch and the global key
 * all start after the first paint: opening never waits on them.
 */
export async function bootDesktop(): Promise<Boot> {
  const settings = createFileSettingsStore({
    text: await readSettingsText(),
    write: writeSettingsText,
    onError: reportQuietly('save the settings'),
  });
  const choose = () => chooseVault(settings);
  const vaultPath = settings.load().vaultPath;
  if (vaultPath === null) return welcome(settings, null, choose);
  let files: VaultFiles;
  try {
    files = await openTauriVaultFiles(vaultPath);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return welcome(settings, `${vaultPath} could not be opened: ${why}`, choose);
  }
  return composeDesktop({ files, settings, vaultPath, choose });
}

async function composeDesktop({
  files,
  settings,
  vaultPath,
  choose,
}: {
  files: VaultFiles;
  settings: FileSettings;
  vaultPath: string;
  choose: () => Promise<void>;
}): Promise<Boot> {
  const { session, search } = await openSession(files);
  // Sync uses the files as they are; everything else waits behind the gate while it commits or merges.
  const gate = createWriteGate({ timers: systemTimers });
  const gated = gatedVaultFiles(files, gate);
  const deps: VaultDeps = { files: gated, session };
  const pendingEdits = createPendingEdits();
  const sync = wireSync({
    deps: { files, session },
    git: tauriGit,
    gate,
    flush: pendingEdits.flushAll,
  });
  const desktop: DesktopControls = {
    vaultPath,
    changeVault: choose,
    remote: () => remoteInfo(tauriGit),
    confirm: askYesNo,
    async setCaptureHotkey(accelerator) {
      await setGlobalShortcut(accelerator, quickCapture);
      settings.save({ ...settings.load(), captureHotkey: accelerator });
    },
    followTheme,
  };
  const granola = wireGranola({ deps, sync, settings, vaultPath });
  const services: AppServices = {
    ...{ files: gated, session, search, settings, sync, desktop, granola, pendingEdits },
    clock: systemClock,
    imageProbe: webviewImageProbe,
    loadMarkdown,
  };
  const start = () => {
    followDisk(deps);
    // Before sync starts, so the import hears the first sync end.
    granola.start();
    sync.start();
    setGlobalShortcut(settings.load().captureHotkey, quickCapture).catch(
      reportQuietly('register the capture key'),
    );
  };
  return { kind: 'app', services, layoutStorage: deviceLayoutStorage(), start };
}

/** The window's chrome in the theme chosen; System hands it back to macOS. */
function followTheme(choice: ThemeChoice): void {
  setWindowTheme(choice === 'system' ? null : choice).catch(reportQuietly('theme the window'));
}

/** The first-start question, in the theme chosen on this Mac before, if any. */
function welcome(
  settings: FileSettings,
  problem: string | null,
  choose: () => Promise<void>,
): Boot {
  createThemeController({ settings, ...browserThemeParts(window), follow: followTheme });
  return { kind: 'welcome', problem, choose };
}

/** Changes on disk (Claude, git, an editor) reach the session one batch at a time, in order. */
function followDisk(deps: VaultDeps): void {
  let queue = Promise.resolve();
  deps.files.watch((paths) => {
    queue = queue
      .then(() => applyExternalChanges(deps, paths))
      .then(() => undefined, reportQuietly('read a changed file'));
  });
}

/** The global key: the window comes forward on a new Inbox note, the caret in it. */
function quickCapture(): void {
  bringWindowForward().catch(reportQuietly('bring the window forward'));
  navigate({ kind: 'new' });
}

/** Asks for the vault folder, keeps it, and starts the app afresh on it. Nothing when dismissed. */
async function chooseVault(settings: FileSettings): Promise<void> {
  const folder = await pickFolder('Choose your notes folder');
  if (folder === null) return;
  settings.save({ ...settings.load(), vaultPath: folder });
  await settings.written();
  window.location.reload();
}
