import { lazy, Suspense, useEffect, useState } from 'react';
import { createAppContext } from './app-context.ts';
import { preloadEditor } from './note/note-pane.tsx';
import { browserLayoutStorage, type LayoutStorage } from './panes/layout-storage.ts';
import { PanesView } from './panes/panes-view.tsx';
import { useWorkspaceSync } from './panes/use-workspace-sync.ts';
import { useRoute } from './routing/use-route.ts';
import { SearchPalette } from './search/search-palette.tsx';
import { AppContext, useApp, type AppServices } from './services.ts';
import { Icon } from './shell/icons.tsx';
import { useShortcuts } from './shell/use-shortcuts.ts';
import { useStartRoute } from './shell/use-start-route.ts';
import { Sidebar } from './sidebar/sidebar.tsx';
import { useUi } from './state/ui-store.ts';
import './theme.css';
import './app.css';
import './shell/dialog.css';

const SettingsDialog = lazy(() => import('./settings/settings-dialog.tsx'));

function Notice() {
  const { ui } = useApp();
  const notice = useUi((state) => state.notice);
  if (notice === null) return null;
  return (
    <div className="app-notice" role="status">
      <span>{notice}</span>
      <button type="button" className="quiet-button" onClick={() => ui.setState({ notice: null })}>
        Dismiss
      </button>
    </div>
  );
}

function Shell() {
  const { services, ui, actions } = useApp();
  const route = useRoute();
  const paletteOpen = useUi((state) => state.paletteOpen);
  const settingsOpen = useUi((state) => state.settingsOpen);
  const drawerOpen = useUi((state) => state.drawerOpen);
  useShortcuts();
  useWorkspaceSync();
  // The editor's code loads straight after the first paint, so ⌘N never waits for it.
  useEffect(() => {
    preloadEditor().catch(actions.report);
  }, [actions]);
  useStartRoute(route);
  // A note or a page chosen in the drawer closes it, on a phone.
  useEffect(() => ui.setState({ drawerOpen: false }), [route, ui]);

  return (
    <div className="app" data-drawer={drawerOpen ? 'open' : 'closed'}>
      <nav className="app-sidebar" aria-label="Sidebar">
        <Sidebar route={route} />
      </nav>
      <div className="app-scrim" onClick={() => ui.setState({ drawerOpen: false })} />
      <main className="app-main">
        <div className="app-topbar">
          <button
            type="button"
            className="quiet-button"
            aria-label="Open the sidebar"
            onClick={() => ui.setState({ drawerOpen: true })}
          >
            <Icon name="menu" />
          </button>
          <span className="grow" />
          <button
            type="button"
            className="quiet-button"
            aria-label="Search"
            onClick={() => ui.setState({ paletteOpen: true })}
          >
            <Icon name="search" />
          </button>
        </div>
        {services.sync !== null ? null : (
          <div className="app-banner" role="note">
            <span>Sample vault — connect a GitHub repository in Settings.</span>
            <button
              type="button"
              className="quiet-button"
              onClick={() => ui.setState({ settingsOpen: true })}
            >
              Settings
            </button>
          </div>
        )}
        <PanesView />
      </main>
      {paletteOpen ? <SearchPalette onClose={() => ui.setState({ paletteOpen: false })} /> : null}
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog onClose={() => ui.setState({ settingsOpen: false })} />
        </Suspense>
      ) : null}
      <Notice />
    </div>
  );
}

/**
 * The app: the sidebar, the panes of tabs, and the palette and dialogs over
 * them. The tabs are kept per device in `layoutStorage` (this browser's, by default).
 */
export function App({
  services,
  layoutStorage = browserLayoutStorage(() => window.localStorage),
}: {
  services: AppServices;
  layoutStorage?: LayoutStorage;
}) {
  const [context] = useState(() => createAppContext(services, layoutStorage));
  useEffect(() => context.vault.connect(), [context]);
  return (
    <AppContext.Provider value={context}>
      <Shell />
    </AppContext.Provider>
  );
}
