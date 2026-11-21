import { applyExternalChanges, openVault, VaultSession } from '../../application/index.ts';
import {
  FixedClock,
  MemorySettingsStore,
  MemoryVaultFiles,
  SimpleSearchEngine,
} from '../../application/testing/index.ts';
import { createAppContext } from '../app-context.ts';
import { activeTabOf, type Layout } from '../panes/layout.ts';
import { memoryLayoutStorage } from '../panes/layout-storage.ts';
import type { MirrorPeer, NoteMirror } from './note-mirror.ts';
import type { OpenNote } from './open-notes.ts';

const PLAN = 'Projects/Larkspur Payroll.md';
const COPY = 'Projects/Larkspur Payroll (conflict 2026-11-21).md';

const tabOnPlan = (id: string) => ({
  tabs: [{ id, view: { kind: 'note' as const, path: PLAN }, preview: false }],
  activeTab: id,
});

/** The plan open in both panes, one tab each. */
const SPLIT_ON_PLAN: Layout = {
  panes: [tabOnPlan('t1'), tabOnPlan('t2')],
  activePane: 0,
  split: 0.5,
  nextId: 3,
};

async function setup() {
  const files = MemoryVaultFiles.of({ [PLAN]: 'Parallel run.' });
  const session = new VaultSession();
  await openVault({ files, session });
  const services = {
    files,
    session,
    settings: new MemorySettingsStore(),
    clock: new FixedClock(new Date(2026, 10, 21, 9, 0)),
    search: new SimpleSearchEngine(),
    sync: null,
    desktop: null,
    pendingEdits: { add: () => () => undefined },
  };
  const app = createAppContext(services, memoryLayoutStorage());
  app.layout.apply(() => SPLIT_ON_PLAN);
  return { app, session, files };
}

/** An editor in a tab, as the open note sees it: what an edit from disk did to it. */
function editorOn(note: OpenNote, text: string) {
  const editor: MirrorPeer<string> & { text: string; adopted: number } = {
    text,
    adopted: 0,
    read: () => editor.text,
    apply: () => undefined,
    adopt: (next) => {
      editor.text = next;
      editor.adopted += 1;
    },
  };
  // The editor's change type is CodeMirror's; this stand-in's edits are whole texts.
  const mirror = note.mirror as unknown as NoteMirror<string>;
  if (mirror.join(editor).alone) note.saver.opened(text);
  return editor;
}

describe('an open note changed on disk', () => {
  it('reaches both tabs on the note, and the next save is based on it', async () => {
    const { app, session, files } = await setup();
    const note = app.openNotes.get(app, PLAN);
    const left = editorOn(note, 'Parallel run.');
    const right = editorOn(note, 'Parallel run.');

    files.edit(PLAN, 'Parallel run, edited by Claude.');
    await applyExternalChanges(app.deps, [PLAN]);

    expect([left.text, right.text]).toEqual([
      'Parallel run, edited by Claude.',
      'Parallel run, edited by Claude.',
    ]);
    expect([left.adopted, right.adopted]).toEqual([1, 1]);
    expect(note.saver.basedOn()).toBe('Parallel run, edited by Claude.');
    note.saver.autosave.schedule(() => 'Parallel run, edited by Claude. Then cut over.');
    await note.saver.autosave.flush();
    expect(session.file(PLAN)?.text).toBe('Parallel run, edited by Claude. Then cut over.');
    expect(session.file(COPY)).toBeNull();
  });

  it('leaves typing alone, and forks it to one conflict copy for both tabs', async () => {
    const { app, session, files } = await setup();
    const note = app.openNotes.get(app, PLAN);
    const left = editorOn(note, 'Parallel run.');
    const right = editorOn(note, 'Parallel run.');
    left.text = 'Parallel run, typed here.';
    right.text = left.text;
    note.saver.autosave.schedule(() => left.text);

    files.edit(PLAN, 'Parallel run, edited by Claude.');
    await applyExternalChanges(app.deps, [PLAN]);
    expect([left.adopted, right.adopted]).toEqual([0, 0]);

    await note.saver.autosave.flush();
    expect(session.file(PLAN)?.text).toBe('Parallel run, edited by Claude.');
    expect(session.file(COPY)?.text).toBe('Parallel run, typed here.');
    expect(session.index.paths().filter((path) => path.includes('conflict'))).toEqual([COPY]);
    const shown = app.layout.getState().panes.map((pane) => activeTabOf(pane).view);
    expect(shown).toEqual([
      { kind: 'note', path: COPY },
      { kind: 'note', path: COPY },
    ]);
  });

  it('does not take the note’s own save for a change from disk', async () => {
    const { app } = await setup();
    const note = app.openNotes.get(app, PLAN);
    const editor = editorOn(note, 'Parallel run.');
    editor.text = 'Parallel run, typed here.';
    note.saver.autosave.schedule(() => editor.text);
    await note.saver.autosave.flush();
    expect(editor.adopted).toBe(0);
    expect(note.saver.basedOn()).toBe('Parallel run, typed here.');
  });
});
