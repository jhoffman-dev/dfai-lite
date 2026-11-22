import { useEffect } from 'react';
import { parseRoute } from '../routing/route.ts';
import { useApp } from '../services.ts';
import type { Workspace } from './workspace.ts';
import { openInFor } from './open-in.ts';

/**
 * Every in-app link (`href="#/…"`: the tree, favorites, backlinks, tags,
 * the sidebar's pages) opens through the workspace, so a ⌘/Ctrl-click or
 * middle click opens a new tab and ⌥-click the other pane, never a browser tab.
 */
function onLinkClick(workspace: Workspace, event: MouseEvent): void {
  if (event.defaultPrevented || event.button > 1) return;
  const link = (event.target as Element | null)?.closest?.('a[href^="#/"]');
  if (link === null || link === undefined) return;
  const route = parseRoute(link.getAttribute('href') ?? '');
  if (route.kind === 'new') return;
  event.preventDefault();
  workspace.open(route, openInFor(event));
}

/** Keeps the tabs in step with the address bar, the vault, and the app's links. */
export function useWorkspaceSync(): void {
  const { workspace, services } = useApp();

  useEffect(() => {
    const onHash = () => workspace.followHash();
    const onClick = (event: MouseEvent) => onLinkClick(workspace, event);
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick);
    document.addEventListener('auxclick', onClick);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick);
      document.removeEventListener('auxclick', onClick);
    };
  }, [workspace]);

  useEffect(() => services.session.subscribe(workspace.followVault), [workspace, services]);
}
