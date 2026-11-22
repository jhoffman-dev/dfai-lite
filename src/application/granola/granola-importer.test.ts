import { IMPORTS_PATH } from '../../domain/meetings/index.ts';
import { VaultSession } from '../session/index.ts';
import type { SyncTimers } from '../sync/index.ts';
import {
  FakeGranola,
  FixedClock,
  fictionalGranolaNote,
  MemoryVaultFiles,
} from '../testing/index.ts';
import { deleteNote, openVault } from '../use-cases/index.ts';
import { createGranolaImporter, GRANOLA_IMPORT_EVERY_MS } from './granola-importer.ts';
import {
  GranolaError,
  NO_GRANOLA_RECORD,
  type GranolaRecord,
  type GranolaRecords,
} from './ports.ts';

/** Timers moved by hand: `advance(ms)` runs whatever falls due, in order. */
class ManualTimers implements SyncTimers {
  private now = 0;
  private pending: { at: number; run: () => void; id: number }[] = [];
  private nextId = 0;

  after(ms: number, run: () => void): () => void {
    const id = this.nextId++;
    this.pending.push({ at: this.now + ms, run, id });
    return () => {
      this.pending = this.pending.filter((timer) => timer.id !== id);
    };
  }

  async advance(ms: number): Promise<void> {
    const until = this.now + ms;
    for (;;) {
      const due = this.pending.filter(({ at }) => at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.pending = this.pending.filter((timer) => timer !== due);
      this.now = due.at;
      due.run();
      await flush();
    }
    this.now = until;
    await flush();
  }
}

const flush = async () => {
  for (let tick = 0; tick < 50; tick++) await Promise.resolve();
};

class MemoryRecords implements GranolaRecords {
  record: GranolaRecord = NO_GRANOLA_RECORD;
  read = () => this.record;
  write = (_: string, record: GranolaRecord) => {
    this.record = record;
  };
}

/** Sync's word, by hand: `pulled()` is a sync that has finished. */
class ManualSync {
  ready = false;
  private listeners = new Set<() => void>();
  isReady = () => this.ready;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  pulled() {
    this.ready = true;
    for (const listener of this.listeners) listener();
  }
}

const PATH = 'Meetings/2026/11/2026-11-17 Larkspur Payroll renewal.md';

let granola: FakeGranola;
let files: MemoryVaultFiles;
let session: VaultSession;
let timers: ManualTimers;
let sync: ManualSync;
let records: MemoryRecords;
let notices: string[];

async function importer() {
  const made = createGranolaImporter({
    granola,
    records,
    vault: { files, session },
    vaultKey: '/Users/example/Notes',
    clock: new FixedClock(new Date('2026-11-20T00:00:00Z')),
    timers,
    timeZone: 'America/Los_Angeles',
    selfEmails: [],
    sync,
  });
  made.onNotice((text) => notices.push(text));
  made.start();
  await flush();
  return made;
}

const lists = () => granola.calls.filter((call) => call.startsWith('list')).length;

beforeEach(async () => {
  granola = new FakeGranola().add(fictionalGranolaNote());
  files = MemoryVaultFiles.of({});
  session = new VaultSession();
  await openVault({ files, session });
  timers = new ManualTimers();
  sync = new ManualSync();
  records = new MemoryRecords();
  notices = [];
});

describe('the Granola import schedule', () => {
  it('waits for the first sync, then imports once as the vault opens, and says what arrived', async () => {
    const made = await importer();
    expect(made.getView()).toMatchObject({ keyState: 'set', waiting: true });
    expect(lists()).toBe(0);
    sync.pulled();
    await flush();
    expect(lists()).toBe(1);
    expect(files.peek(PATH)).toBeDefined();
    expect(notices).toEqual(['A meeting arrived from Granola.']);
    expect(made.getView()).toMatchObject({ waiting: false, importing: false });
    expect(made.getView().lastResult).toBe('Imported 1 meeting.');
    expect(records.record).toMatchObject({
      watermark: '2026-11-17T17:41:03.000Z',
      lastImportAt: '2026-11-20T00:00:00.000Z',
    });
  });

  it('imports every 15 minutes from the watermark less a day, and not while automatic import is off', async () => {
    sync.ready = true;
    const made = await importer();
    expect(lists()).toBe(1);
    await timers.advance(GRANOLA_IMPORT_EVERY_MS);
    expect(lists()).toBe(2);
    expect(granola.calls.at(-1)).toBe('list 2026-11-16T17:41:03.000Z first');
    made.setAutomatic(false);
    await timers.advance(GRANOLA_IMPORT_EVERY_MS * 3);
    expect(lists()).toBe(2);
    expect(records.record.automatic).toBe(false);
  });

  it('with automatic import off, imports only when asked', async () => {
    records.record = { ...NO_GRANOLA_RECORD, automatic: false };
    sync.ready = true;
    const made = await importer();
    await timers.advance(GRANOLA_IMPORT_EVERY_MS);
    expect(lists()).toBe(0);
    made.importNow();
    await flush();
    expect(lists()).toBe(1);
    expect(granola.calls[0]).toBe('list all first');
  });

  it('runs one import at a time: Import now pressed during one runs once, right after it', async () => {
    sync.ready = true;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const list = granola.listNotes.bind(granola);
    granola.listNotes = async (args) => {
      await gate;
      return list(args);
    };
    const made = await importer();
    made.importNow();
    made.importNow();
    expect(made.getView().importing).toBe(true);
    release();
    await flush();
    await flush();
    // The startup import, then Import now once, however often it was pressed.
    expect(lists()).toBe(2);
    await flush();
    expect(lists()).toBe(2);
  });

  it('never imports without a key, and connecting with one Granola accepts starts the import', async () => {
    granola.key = null;
    sync.ready = true;
    const made = await importer();
    expect(made.getView().keyState).toBe('none');
    expect(lists()).toBe(0);
    await made.connect('grn_Fict10nalKey');
    await flush();
    expect(made.getView().keyState).toBe('accepted');
    expect(lists()).toBe(1);
  });

  it('a key Granola refuses says so, as a notice, and imports nothing', async () => {
    granola.key = null;
    sync.ready = true;
    const made = await importer();
    await made.connect('grn_WrongKey');
    await flush();
    expect(made.getView().keyState).toBe('refused');
    expect(notices).toEqual(['Granola refused this key.']);
    expect(lists()).toBe(0);
  });

  it('disconnecting forgets the key and stops the timer', async () => {
    sync.ready = true;
    const made = await importer();
    await made.disconnect();
    expect(made.getView().keyState).toBe('none');
    expect(granola.key).toBeNull();
    await timers.advance(GRANOLA_IMPORT_EVERY_MS * 2);
    expect(lists()).toBe(1);
  });

  it('an Import now that fails offline is said quietly, as a notice, and changes nothing', async () => {
    sync.ready = true;
    records.record = { ...NO_GRANOLA_RECORD, automatic: false };
    const made = await importer();
    granola.listFailure = new GranolaError({ kind: 'unreachable', message: 'offline' });
    made.importNow();
    await flush();
    expect(notices[0]).toContain('Granola could not be reached.');
    expect(made.getView().problem).toContain('The next import tries again.');
    expect(files.peek(PATH)).toBeUndefined();
  });

  it('brings back the meetings the person deleted, when asked', async () => {
    sync.ready = true;
    const made = await importer();
    await deleteNote({ files, session }, { path: PATH });
    made.importNow();
    await flush();
    expect(made.getView().dismissed).toBe(1);
    expect(files.peek(PATH)).toBeUndefined();
    made.importDeletedAgain();
    await flush();
    await flush();
    expect(files.peek(PATH)).toBeDefined();
    expect(made.getView().dismissed).toBe(0);
    expect(files.peek(IMPORTS_PATH)).not.toContain('dismissed');
  });
});
