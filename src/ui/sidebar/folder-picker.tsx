import { useMemo, useState, type KeyboardEvent } from 'react';
import { folderOf, noteTitle, pathMovedInto } from '../../application/index.ts';
import type { FolderNode, VaultEntry, VaultPath } from '../../domain/vault/index.ts';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { useVault } from '../state/vault-store.ts';
import './folder-picker.css';

type Choice =
  | { readonly kind: 'folder'; readonly path: VaultPath; readonly here: boolean }
  | { readonly kind: 'create'; readonly path: VaultPath };

/** Every folder in tree order, the top of the vault ('') first. */
function folderPaths(root: FolderNode): VaultPath[] {
  const walk = (folder: FolderNode): VaultPath[] =>
    folder.folders.flatMap((child) => [child.path, ...walk(child)]);
  return ['', ...walk(root)];
}

/** A folder path as typed: no slashes at its ends, no space around its parts. */
function typedPath(query: string): VaultPath {
  return query
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('/');
}

/**
 * The folders `entry` may move into that match `query` (any part of the
 * path, case aside), with the one it is in marked; a folder it cannot go
 * into (itself, one under it) is left out. A typed path no folder has is
 * offered as a new folder.
 */
function choicesFor(root: FolderNode, entry: VaultEntry, query: string): Choice[] {
  const wanted = query.trim().toLowerCase();
  const typed = typedPath(query);
  const folders: Choice[] = [];
  for (const path of folderPaths(root)) {
    const name = path === '' ? 'top of the vault' : path.toLowerCase();
    if (wanted !== '' && !name.includes(wanted)) continue;
    const here = folderOf(entry.path) === path;
    if (!here && pathMovedInto(entry, path) === null) continue;
    folders.push({ kind: 'folder', path, here });
  }
  const exists = folders.some((choice) => choice.path.toLowerCase() === typed.toLowerCase());
  // With nothing typed, the row says how to make a folder; choosing it does nothing.
  return typed !== '' && exists ? folders : [...folders, { kind: 'create', path: typed }];
}

/**
 * Where a note or a folder moves to: type to filter the folders, ↑/↓ and
 * Enter (or a click) to move it there. A name no folder has is offered as
 * "New folder", made first and then moved into.
 */
export function FolderPicker({ entry, onClose }: { entry: VaultEntry; onClose: () => void }) {
  const { actions } = useApp();
  const tree = useVault((vault) => vault.tree);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const choices = useMemo(() => choicesFor(tree, entry, query), [tree, entry, query]);
  const current = Math.min(selected, choices.length - 1);
  const name = entry.kind === 'note' ? noteTitle(entry.path) : entry.path;

  const choose = async (choice: Choice | undefined) => {
    if (choice === undefined || (choice.kind === 'folder' && choice.here)) return;
    if (choice.kind === 'create' && choice.path === '') return;
    onClose();
    if (choice.kind === 'create') {
      const made = await actions.createFolder(choice.path);
      if (made.kind === 'refused') return;
    }
    await actions.moveInto(entry, choice.path);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose();
    else if (event.key === 'Enter') choose(choices[current]).catch(actions.report);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelected((current + step + choices.length) % Math.max(choices.length, 1));
    } else return;
    event.preventDefault();
  };

  return (
    <div
      className="dialog-scrim"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="palette folder-picker" role="dialog" aria-modal="true" aria-label="Move to">
        <div className="folder-picker-title">Move “{name}” to…</div>
        <input
          className="palette-input"
          role="combobox"
          aria-label="Folder"
          aria-expanded={choices.length > 0}
          aria-controls="folder-picker-results"
          aria-activedescendant={choices.length > 0 ? `folder-choice-${current}` : undefined}
          placeholder="Type to find a folder, or name a new one"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul
          id="folder-picker-results"
          className="palette-results"
          role="listbox"
          aria-label="Folders"
        >
          {choices.map((choice, at) => (
            <li
              key={`${choice.kind}:${choice.path}`}
              id={`folder-choice-${at}`}
              role="option"
              aria-selected={at === current}
              aria-disabled={choice.kind === 'folder' && choice.here}
              className={`palette-row folder-choice is-${choice.kind}`}
              onPointerMove={() => setSelected(at)}
              onClick={() => void choose(choice).catch(actions.report)}
            >
              <Icon name={choice.kind === 'create' ? 'folder-plus' : 'folder'} />
              <span className="palette-title">
                {choice.kind === 'create'
                  ? choice.path === ''
                    ? 'New folder… (type its name above)'
                    : `New folder “${choice.path}”`
                  : choice.path === ''
                    ? 'Top of the vault'
                    : choice.path}
              </span>
              {choice.kind === 'folder' && choice.here ? (
                <span className="palette-folder">Here now</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
