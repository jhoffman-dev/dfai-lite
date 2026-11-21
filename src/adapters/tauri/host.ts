import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import type { GitPort, GitResult } from '../../application/index.ts';
import { hostError } from './vault-files.ts';

export { isTauri } from '@tauri-apps/api/core';

/** The Mac's own git, run by the host in the open vault (`src-tauri/src/git.rs`). */
export const tauriGit: GitPort = {
  async run(command) {
    try {
      return await invoke<GitResult>('git_run', { command });
    } catch (error) {
      throw hostError(error);
    }
  },
  macName: () => invoke<string>('mac_name'),
};

/** This Mac's settings file, as text; null when there is none yet. */
export const readSettingsText = (): Promise<string | null> => invoke('read_settings');

export async function writeSettingsText(text: string): Promise<void> {
  try {
    await invoke('write_settings', { text });
  } catch (error) {
    throw hostError(error);
  }
}

/** Asks for the vault folder in the Mac's own folder dialog; null when dismissed. */
export async function pickFolder(title: string): Promise<string | null> {
  const chosen = await open({ directory: true, multiple: false, title });
  return typeof chosen === 'string' ? chosen : null;
}

/** Brings the window forward from anywhere: minimised, hidden or behind another app. */
export async function bringWindowForward(): Promise<void> {
  const window = getCurrentWindow();
  await window.unminimize();
  await window.show();
  await window.setFocus();
}

/**
 * Makes `accelerator` (Tauri's names, e.g. `Alt+Command+N`) the one global
 * shortcut, calling `onPressed` when it goes down; an empty one clears it.
 * Rejects when the Mac refuses the key (another app holds it).
 */
export async function setGlobalShortcut(accelerator: string, onPressed: () => void): Promise<void> {
  await unregisterAll();
  if (accelerator === '') return;
  await register(accelerator, (event) => {
    if (event.state === 'Pressed') onPressed();
  });
}
