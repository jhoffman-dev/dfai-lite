import { createOpenNotes } from './note/open-notes.ts';
import { createLayoutStore } from './panes/layout-store.ts';
import type { LayoutStorage } from './panes/layout-storage.ts';
import { isNarrow } from './panes/narrow.ts';
import { createWorkspace } from './panes/workspace.ts';
import type { AppContextValue, AppServices } from './services.ts';
import { createNoteActions } from './state/note-actions.ts';
import { createUiStore } from './state/ui-store.ts';
import { createVaultStore } from './state/vault-store.ts';

/** The stores and actions the components share, built once per app on its services. */
export function createAppContext(services: AppServices, storage: LayoutStorage): AppContextValue {
  const { session, settings } = services;
  const deps = { files: services.files, session };
  const prefs = settings.load().ui;
  const ui = createUiStore({ source: prefs.source });
  const exists = (path: string) => session.file(path) !== null;
  // A first launch with tabs reopens the note last open before them.
  const last = prefs.lastOpenPath;
  const view = last !== null && exists(last) ? { kind: 'note' as const, path: last } : undefined;
  const layout = createLayoutStore({
    storage,
    exists,
    fallback: { view: view ?? { kind: 'home' }, source: prefs.source },
  });
  const workspace = createWorkspace({ layout, ui, session, canSplit: () => !isNarrow() });
  const confirm = services.desktop?.confirm;
  const actions = createNoteActions({
    deps,
    ui,
    settings,
    layout,
    workspace,
    ...(confirm === undefined ? {} : { confirm }),
  });
  const vault = createVaultStore(session);
  return {
    services,
    deps,
    vault,
    ui,
    layout,
    workspace,
    openNotes: createOpenNotes(session),
    actions,
  };
}
