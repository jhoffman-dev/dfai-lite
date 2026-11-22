import { useCallback, useEffect, useState } from 'react';
import { foldersAbove } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { useApp } from '../services.ts';

/** The folder and every folder above it. */
const withAncestors = (folder: VaultPath): VaultPath[] =>
  folder === '' ? [] : [folder, ...foldersAbove(folder)];

/** Remembers which folders are open, per device, and opens the folders above the note shown. */
export function useExpandedFolders(activePath: VaultPath | null) {
  const { services, actions } = useApp();
  const [state, setState] = useState(() => ({
    expanded: new Set(services.settings.load().ui.expandedFolders) as ReadonlySet<VaultPath>,
    revealedFor: null as VaultPath | null,
  }));

  // Reveal once per note opened (adjusted while rendering), so a folder closed by hand stays closed.
  let current = state;
  if (activePath !== null && activePath !== state.revealedFor) {
    const closed = foldersAbove(activePath).filter((folder) => !state.expanded.has(folder));
    const expanded = closed.length === 0 ? state.expanded : new Set([...state.expanded, ...closed]);
    current = { expanded, revealedFor: activePath };
    setState(current);
  }

  const { expanded } = current;
  useEffect(() => {
    actions.updatePrefs({ expandedFolders: [...expanded].sort() });
  }, [expanded, actions]);

  const toggle = useCallback((path: VaultPath) => {
    setState((before) => {
      const next = new Set(before.expanded);
      if (!next.delete(path)) next.add(path);
      return { ...before, expanded: next };
    });
  }, []);
  /** Opens the folder and every folder above it. */
  const expand = useCallback((folder: VaultPath) => {
    setState((before) => {
      const closed = withAncestors(folder).filter((path) => !before.expanded.has(path));
      if (closed.length === 0) return before;
      return { ...before, expanded: new Set([...before.expanded, ...closed]) };
    });
  }, []);
  return { expanded, toggle, expand };
}
