import { openVault, VaultSession, type StoredFile } from '../../application/index.ts';
import {
  FixedClock,
  MemoryNoteStore,
  MemorySettingsStore,
  SimpleSearchEngine,
} from '../../application/testing/index.ts';
import { createAppContext } from '../app-context.ts';
import { memoryLayoutStorage } from '../panes/layout-storage.ts';
import { parseRoute } from '../routing/route.ts';
import { createNoteSaver } from './note-saver.ts';

const PLAN = 'Projects/Larkspur Payroll.md';

async function setup() {
  const noteStore = MemoryNoteStore.of({ [PLAN]: 'Parallel run.' });
  const session = new VaultSession();
  await openVault({ store: noteStore, session });
  const services = {
    noteStore,
    session,
    settings: new MemorySettingsStore(),
    clock: new FixedClock(new Date(2026, 10, 21, 9, 0)),
    search: new SimpleSearchEngine(),
    sync: null,
    reconnect: () => undefined,
  };
  const app = createAppContext(services, memoryLayoutStorage());
  app.workspace.open({ kind: 'note', path: PLAN });
  return { app, session, ui: app.ui };
}

/** What a sync does when it pulls another device's edit: the note changes, clean. */
function pulledEdit(session: VaultSession, text: string): void {
  const file: StoredFile = { path: PLAN, text, baseSha: 'remote', dirty: false };
  session.applyWrite(file);
}

describe('saving a note from the editor', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('saves over the note when nothing changed underneath', async () => {
    const { app, session } = await setup();
    const saver = createNoteSaver(app, PLAN);
    saver.opened('Parallel run.');
    saver.autosave.schedule(() => 'Parallel run for two cycles.');
    await saver.autosave.flush();
    expect(session.file(PLAN)?.text).toBe('Parallel run for two cycles.');
  });

  it('keeps both when a sync changed the note while typing, and its tab moves to the copy', async () => {
    const { app, session, ui } = await setup();
    const saver = createNoteSaver(app, PLAN);
    saver.opened('Parallel run.');
    pulledEdit(session, 'Parallel run, edited on the laptop.');
    saver.autosave.schedule(() => 'Parallel run, typed here.');
    await saver.autosave.flush();

    expect(session.file(PLAN)?.text).toBe('Parallel run, edited on the laptop.');
    const route = parseRoute(window.location.hash);
    expect(route).toEqual({
      kind: 'note',
      path: 'Projects/Larkspur Payroll (conflict 2026-11-21).md',
    });
    expect(route.kind === 'note' && session.file(route.path)?.text).toBe(
      'Parallel run, typed here.',
    );
    expect(ui.getState().notice).toMatch(/changed on another device/);
  });

  it('bases the next save on the last one, so its own saves never look like a sync', async () => {
    const { app, session } = await setup();
    const saver = createNoteSaver(app, PLAN);
    saver.opened('Parallel run.');
    saver.autosave.schedule(() => 'One.');
    await saver.autosave.flush();
    saver.autosave.schedule(() => 'One. Two.');
    await saver.autosave.flush();
    expect(session.file(PLAN)?.text).toBe('One. Two.');
    expect(session.index.paths()).toEqual([PLAN]);
  });
});
