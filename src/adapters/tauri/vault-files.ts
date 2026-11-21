import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  FileChangedError,
  FileExistsError,
  type VaultFiles,
  type VaultSnapshot,
} from '../../application/index.ts';

/** The host's error prefixes (`src-tauri/src/vault.rs`), as the port's errors. */
export function hostError(error: unknown): Error {
  const message = typeof error === 'string' ? error : String(error);
  if (message.startsWith('changed:')) return new FileChangedError(message.slice(8).trim());
  if (message.startsWith('exists:')) return new FileExistsError(message.slice(7).trim());
  return new Error(message);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw hostError(error);
  }
}

/** The changed-files event the host's watcher sends (`src-tauri/src/watcher.rs`). */
const VAULT_CHANGED = 'vault-changed';

/**
 * The vault folder on this Mac, through the Rust host: it opens the folder
 * (and starts watching it) first, then every call is confined to it.
 */
export async function openTauriVaultFiles(folder: string): Promise<VaultFiles> {
  await call('open_vault', { folder });
  return {
    readAll: () => call<VaultSnapshot>('read_vault'),
    read: (path) => call<string | null>('read_file', { path }),
    write: ({ path, text, expected }) => call('write_file', { path, text, expected }),
    rename: (from, to) => call('rename_file', { from, to }),
    remove: (path) => call('delete_file', { path }),
    watch(listener) {
      const unlisten = listen<string[]>(VAULT_CHANGED, (event) => listener(event.payload));
      return () => void unlisten.then((stop) => stop());
    },
  };
}
