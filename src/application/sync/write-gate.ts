import type { VaultFiles } from '../ports/index.ts';
import type { SyncTimers } from './sync-scheduler.ts';

/**
 * Keeps the editor, Claude's changes as the watcher reports them, and every
 * other use-case off the disk while sync commits or merges: git checks a
 * file, then writes it, and a save in between would be lost. Sync holds it;
 * everything else passes through it, waiting while it is held.
 */
export interface WriteGate {
  /** Shuts the gate until the returned function is called. */
  hold(): () => void;
  /** Resolves once the gate is open; rejects when it stays shut past the wait allowed. */
  pass(): Promise<void>;
}

/** Longer than any one git step may run (the host stops those at two minutes). */
export const MAX_GATE_WAIT_MS = 180_000;

export function createWriteGate({
  timers,
  maxWaitMs = MAX_GATE_WAIT_MS,
}: {
  timers: SyncTimers;
  maxWaitMs?: number;
}): WriteGate {
  let holds = 0;
  let waiting: (() => void)[] = [];
  const open = () => {
    const released = waiting;
    waiting = [];
    for (const go of released) go();
  };
  return {
    hold() {
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (holds === 0) open();
      };
    },
    pass() {
      if (holds === 0) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const cancel = timers.after(maxWaitMs, () => {
          waiting = waiting.filter((go) => go !== proceed);
          reject(new Error('Sync is taking a long time; your text is still in the editor.'));
        });
        const proceed = () => {
          cancel();
          resolve();
        };
        waiting.push(proceed);
      });
    },
  };
}

/** The vault's files behind the gate: what everything but sync itself is given. */
export function gatedVaultFiles(files: VaultFiles, gate: WriteGate): VaultFiles {
  const pass = () => gate.pass();
  return {
    readAll: () => pass().then(() => files.readAll()),
    read: (path) => pass().then(() => files.read(path)),
    write: (request) => pass().then(() => files.write(request)),
    rename: (from, to) => pass().then(() => files.rename(from, to)),
    remove: (request) => pass().then(() => files.remove(request)),
    createFolder: (path) => pass().then(() => files.createFolder(path)),
    removeFolder: (path) => pass().then(() => files.removeFolder(path)),
    renameFolder: (from, to) => pass().then(() => files.renameFolder(from, to)),
    readIgnoreFile: () => pass().then(() => files.readIgnoreFile()),
    writeIgnoreFile: (request) => pass().then(() => files.writeIgnoreFile(request)),
    findUnsyncable: () => pass().then(() => files.findUnsyncable()),
    watch: (listener) => files.watch(listener),
  };
}
