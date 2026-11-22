import { applyExternalChanges, openVault, VaultSession } from '../../application/index.ts';
import {
  FixedClock,
  MemorySettingsStore,
  MemoryVaultFiles,
  plainMarkdown,
  SimpleSearchEngine,
} from '../../application/testing/index.ts';
import { createAppContext } from '../app-context.ts';
import { memoryLayoutStorage } from '../panes/layout-storage.ts';
import { parseRoute } from '../routing/route.ts';
import { createNoteSaver } from './note-saver.ts';

const PLAN = 'Projects/Larkspur Payroll.md';

async function setup() {
  const files = MemoryVaultFiles.of({ [PLAN]: 'Parallel run.' });
  const session = new VaultSession();
  await openVault({ files, session });
  const services = {
    files,
    session,
    settings: new MemorySettingsStore(),
    clock: new FixedClock(new Date(2026, 10, 21, 9, 0)),
    imageProbe: { canShow: async () => true },
    search: new SimpleSearchEngine(),
    sync: null,
    desktop: null,
    granola: null,
    pendingEdits: { add: () => () => undefined, flushAll: () => Promise.resolve() },
    loadMarkdown: () => Promise.resolve(plainMarkdown),
  };
  const app = createAppContext(services, memoryLayoutStorage());
  app.workspace.open({ kind: 'note', path: PLAN });
  return { app, session, ui: app.ui, deps: { files, session } };
}

/** What a sync (or Claude) does: the note changes on disk, and the session hears. */
async function editOnDisk(deps: { files: MemoryVaultFiles; session: VaultSession }, text: string) {
  deps.files.edit(PLAN, text);
  await applyExternalChanges(deps, [PLAN]);
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
    const { app, session, ui, deps } = await setup();
    const saver = createNoteSaver(app, PLAN);
    saver.opened('Parallel run.');
    await editOnDisk(deps, 'Parallel run, edited on the laptop.');
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
    expect(ui.getState().notice).toMatch(/changed elsewhere/);
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

  it('keeps a write that failed waiting, says so, and saves it later without forking', async () => {
    const { app, session, ui, deps } = await setup();
    const saver = createNoteSaver(app, PLAN);
    saver.opened('Parallel run.');
    vi.spyOn(deps.files, 'write').mockRejectedValueOnce(new Error('The disk is full'));
    let typed = 'Parallel run, typed.';
    saver.autosave.schedule(() => typed);
    await saver.autosave.flush();

    expect(session.file(PLAN)?.text).toBe('Parallel run.');
    expect(saver.basedOn()).toBe('Parallel run.');
    expect(ui.getState().notice).toMatch(/Could not save .*The disk is full.*Trying again/);
    expect(saver.autosave.isIdle()).toBe(false);

    typed = 'Parallel run, typed, and more.';
    await saver.autosave.flush();
    expect(session.file(PLAN)?.text).toBe('Parallel run, typed, and more.');
    expect(session.index.paths()).toEqual([PLAN]);
    expect(window.location.hash).not.toMatch(/conflict/);
  });
});
