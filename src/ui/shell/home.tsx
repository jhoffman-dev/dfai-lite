import { useApp } from '../services.ts';
import { useVault } from '../state/vault-store.ts';
import { keyFor } from './shortcuts.ts';
import { useKeyHost } from './use-shortcuts.ts';

/** What a blank tab shows: how to start a note or find one. */
export function Home() {
  const { actions } = useApp();
  const empty = useVault((vault) => vault.tree.noteCount === 0);
  const host = useKeyHost();
  return (
    <div className="app-empty">
      <p>
        {empty ? 'No notes yet. ' : null}
        Press <kbd>{keyFor('note.new', host)}</kbd> to start a note,{' '}
        <kbd>{keyFor('palette.open', host)}</kbd> to find one.
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
