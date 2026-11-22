import { folderOf } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { keyFor } from '../shell/shortcuts.ts';
import { useKeyHost } from '../shell/use-shortcuts.ts';

/** The folder the note is in, as a button that opens the folder picker to move it. */
export function NoteFolderButton({ path }: { path: VaultPath }) {
  const { ui } = useApp();
  const host = useKeyHost();
  const folder = folderOf(path);
  return (
    <button
      type="button"
      className="btn btn--ghost page-bar__action"
      aria-label={`Move to another folder (now in ${folder === '' ? 'the top of the vault' : folder})`}
      title={`Move to… (${keyFor('note.move', host)})`}
      onClick={() => ui.setState({ moving: { kind: 'note', path } })}
    >
      <Icon name="folder" size={15} />
      <span className="page-bar__action-label">{folder === '' ? 'Move to…' : folder}</span>
    </button>
  );
}
