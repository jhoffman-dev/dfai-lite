import { useRef, useState, type KeyboardEvent } from 'react';
import { joinPath, newFolderProblem } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';

/**
 * A new folder being named in place, in the tree under `parent` ('' for the
 * top). Enter makes it, Escape lets it go; leaving the field makes it when
 * the name can be used and lets it go when not. Why a name cannot be used is
 * shown under the field as it is typed.
 */
export function NewFolderRow({
  parent,
  indent,
  onMade,
  onDone,
}: {
  parent: VaultPath;
  /** Pixels from the left, lined up with the rows beside it. */
  indent: number;
  onMade: (path: VaultPath) => void;
  onDone: () => void;
}) {
  const { actions, services } = useApp();
  const [name, setName] = useState('');
  const settled = useRef(false);
  const path = joinPath(parent, name.trim());
  const problem = name.trim() === '' ? null : newFolderProblem(services.session, path);

  const make = async () => {
    if (settled.current) return;
    settled.current = true;
    onDone();
    const result = await actions.createFolder(path);
    if (result.kind === 'created') onMade(result.path);
  };

  const cancel = () => {
    settled.current = true;
    onDone();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (name.trim() !== '' && problem === null) make().catch(actions.report);
    }
  };

  return (
    <div className="tree-new-folder" style={{ paddingLeft: indent }}>
      <Icon name="folder" size={15} />
      <input
        className="tree-new-folder-input"
        aria-label="New folder name"
        aria-invalid={problem !== null}
        aria-describedby={problem === null ? undefined : 'new-folder-problem'}
        placeholder="Folder name"
        autoFocus
        spellCheck={false}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (settled.current) return;
          if (name.trim() !== '' && problem === null) make().catch(actions.report);
          else cancel();
        }}
      />
      {problem === null ? null : (
        <span id="new-folder-problem" className="tree-new-folder-problem" role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}
