import {
  createDeletionApprovals,
  deleteNote,
  openVault,
  saveNoteText,
  VaultSession,
  type SyncScheduler,
  type SyncStatus,
} from '../application/index.ts';
import { MemoryVaultFiles } from '../application/testing/index.ts';
import { connectSync } from './sync-controls.ts';

const PLAN = 'Projects/Larkspur Payroll.md';
const COPY = 'Projects/Larkspur Payroll (conflict 2026-11-21).md';
const IDLE: SyncStatus = {
  phase: 'idle',
  conflicts: 0,
  lastSyncedAt: null,
  message: null,
  deletions: [],
};

class FakeScheduler implements SyncScheduler {
  current = IDLE;
  pushes = 0;
  wakes = 0;
  private listeners = new Set<(status: SyncStatus) => void>();
  start = async () => undefined;
  stop = () => undefined;
  noteChanged = () => {
    this.pushes += 1;
  };
  wake = async () => {
    this.wakes += 1;
  };
  status = () => this.current;
  subscribe(listener: (status: SyncStatus) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(next: Partial<SyncStatus>) {
    this.current = { ...this.current, ...next };
    for (const listener of this.listeners) listener(this.current);
  }
}

class FakePage {
  visible = true;
  private listeners = new Map<string, () => void>();
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }
  isVisible = () => this.visible;
  fire(type: string) {
    this.listeners.get(type)?.();
  }
}

async function setup(files: Record<string, string> = { [PLAN]: 'Parallel run.' }) {
  const vaultFiles = MemoryVaultFiles.of(files);
  const session = new VaultSession();
  await openVault({ files: vaultFiles, session });
  const scheduler = new FakeScheduler();
  const page = new FakePage();
  const controls = connectSync({ scheduler, session, page, approvals: createDeletionApprovals() });
  return { deps: { files: vaultFiles, session }, session, scheduler, page, controls };
}

describe('sync wired to the vault', () => {
  it('asks for a push when the vault changes, not while a sync writes what it pulled', async () => {
    const { deps, session, scheduler } = await setup();
    await saveNoteText(deps, { path: PLAN, text: 'Edited here.' });
    expect(scheduler.pushes).toBe(1);
    scheduler.publish({ phase: 'syncing' });
    session.applyWrite({ path: PLAN, text: 'Pulled.' });
    expect(scheduler.pushes).toBe(1);
    scheduler.publish({ phase: 'idle' });
    session.applyWrite({ path: PLAN, text: 'Edited by Claude.' });
    expect(scheduler.pushes).toBe(2);
  });

  it('says sync is off, with why', async () => {
    const { scheduler, controls } = await setup();
    scheduler.publish({ phase: 'off', message: 'No remote.' });
    expect(controls.getStatus()).toEqual({ kind: 'off', message: 'No remote.' });
  });

  it('leaves a delete made by a running sync alone, but pushes one made by hand', async () => {
    const { deps, session, scheduler } = await setup();
    scheduler.publish({ phase: 'syncing' });
    session.applyDelete(PLAN);
    expect(scheduler.pushes).toBe(0);
    scheduler.publish({ phase: 'idle' });
    await saveNoteText(deps, { path: 'Welcome.md', text: 'Hello.' });
    await deleteNote(deps, { path: 'Welcome.md' });
    expect(scheduler.pushes).toBe(2);
  });

  it('counts the conflict copies still in the vault, as they come and go', async () => {
    const { deps, controls } = await setup({ [PLAN]: 'a', [COPY]: 'b' });
    expect(controls.getStatus()).toEqual({ kind: 'conflicts', count: 1, lastSyncedAt: null });
    await deleteNote(deps, { path: COPY });
    expect(controls.getStatus()).toEqual({ kind: 'idle', lastSyncedAt: null });
    await saveNoteText(deps, { path: COPY, text: 'again' });
    expect(controls.getStatus()).toMatchObject({ kind: 'conflicts', count: 1 });
  });

  it('shows why sync stopped, and tells listeners', async () => {
    const { scheduler, controls } = await setup();
    const heard = vi.fn();
    controls.subscribe(heard);
    scheduler.publish({ phase: 'error', message: 'Could not merge the remote’s changes.' });
    expect(controls.getStatus()).toEqual({
      kind: 'error',
      message: 'Could not merge the remote’s changes.',
    });
    scheduler.publish({ phase: 'needs-sign-in', message: 'Bad credentials' });
    expect(controls.getStatus()).toEqual({ kind: 'needs-sign-in' });
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('syncs on coming back online, into view, and on Sync now', async () => {
    const { scheduler, page, controls } = await setup();
    page.fire('online');
    page.visible = false;
    page.fire('visibilitychange');
    page.visible = true;
    page.fire('visibilitychange');
    controls.syncNow();
    expect(scheduler.wakes).toBe(3);
  });
});
