import { VaultSession } from '../session/index.ts';
import { FixedClock, MemoryVaultFiles } from '../testing/index.ts';
import { openVault, reloadVault, saveNoteText } from '../use-cases/index.ts';
import { createWriteGate, gatedVaultFiles, type SyncTimers } from './index.ts';

const PLAN = 'Projects/Larkspur Payroll.md';

/** Timers fired by hand. */
function manualTimers() {
  const pending: (() => void)[] = [];
  const timers: SyncTimers = {
    after(_ms, run) {
      pending.push(run);
      return () => pending.splice(pending.indexOf(run), 1);
    },
  };
  return { timers, fireAll: () => [...pending].forEach((run) => run()) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the write gate', () => {
  it('holds a save while sync merges, then forks it if the merge changed the note', async () => {
    const files = MemoryVaultFiles.of({ [PLAN]: 'Parallel run.' });
    const session = new VaultSession();
    const { timers } = manualTimers();
    const gate = createWriteGate({ timers });
    const editor = { files: gatedVaultFiles(files, gate), session };
    await openVault(editor);

    const release = gate.hold();
    const saving = saveNoteText(editor, {
      path: PLAN,
      text: 'Parallel run, typed here.',
      basedOnText: 'Parallel run.',
      clock: new FixedClock(new Date(2026, 10, 21, 9, 0)),
    });
    await tick();
    // The save waits: git's merge writes the note meanwhile, and sync reads it back.
    expect(files.peek(PLAN)).toBe('Parallel run.');
    files.edit(PLAN, 'Parallel run, merged from the laptop.');
    await reloadVault({ files, session });
    release();

    const copy = 'Projects/Larkspur Payroll (conflict 2026-11-21).md';
    expect(await saving).toEqual({ kind: 'forked', path: copy, keptPath: PLAN });
    expect(files.peek(PLAN)).toBe('Parallel run, merged from the laptop.');
    expect(files.peek(copy)).toBe('Parallel run, typed here.');
  });

  it('lets everything through while open, and gives up on a wait that runs too long', async () => {
    const { timers, fireAll } = manualTimers();
    const gate = createWriteGate({ timers, maxWaitMs: 1 });
    await gate.pass();
    gate.hold();
    const waiting = gate.pass();
    fireAll();
    await expect(waiting).rejects.toThrow(/taking a long time/);
  });
});
