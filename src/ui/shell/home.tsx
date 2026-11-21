import { useSyncExternalStore } from 'react';
import { useApp } from '../services.ts';
import { useVault } from '../state/vault-store.ts';
import type { SyncControls } from '../sync/sync-status.ts';

/** Fetching the vault on the first sync, or a vault with no notes yet. */
function EmptyVault({ sync }: { sync: SyncControls }) {
  const status = useSyncExternalStore(sync.subscribe, sync.getStatus);
  return (
    <div className="app-empty" role="status">
      {status.kind === 'syncing'
        ? 'Fetching your notes from GitHub…'
        : 'No notes yet. Start one with New note.'}
    </div>
  );
}

/** What a blank tab shows: how to start a note or find one. */
export function Home() {
  const { actions, services } = useApp();
  const empty = useVault((vault) => vault.tree.noteCount === 0);
  if (empty && services.sync !== null) return <EmptyVault sync={services.sync} />;
  return (
    <div className="app-empty">
      <p>
        Press <kbd>⌥N</kbd> or <kbd>Ctrl N</kbd> to start a note, <kbd>⌘K</kbd> to find one.
      </p>
      <button
        type="button"
        className="primary-button"
        onClick={() => actions.newNote().catch(actions.report)}
      >
        New note
      </button>
    </div>
  );
}
