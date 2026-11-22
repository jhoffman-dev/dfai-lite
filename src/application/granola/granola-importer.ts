import {
  granolaArrivalNotice,
  granolaFailureWords,
  granolaReportLine,
  type GranolaPullMode,
} from '../../domain/granola/index.ts';
import { restoreDismissed } from '../../domain/meetings/index.ts';
import type { Clock } from '../ports/index.ts';
import type { SyncTimers } from '../sync/index.ts';
import { readImportLedger, writeImportLedger, type VaultDeps } from '../use-cases/index.ts';
import {
  importGranolaMeetings,
  type GranolaImportReport,
  type GranolaNoteProblem,
} from './import-granola-meetings.ts';
import {
  GranolaError,
  type GranolaKeyStatus,
  type GranolaPort,
  type GranolaRecord,
  type GranolaRecords,
} from './ports.ts';

/** How often an open vault is imported into while automatic import is on (DFAI's 15 minutes). */
export const GRANOLA_IMPORT_EVERY_MS = 15 * 60_000;

/**
 * What this Mac holds for the vault, as Settings shows it: being asked; no
 * key; a key; a key Granola has just accepted; a key whose last answer from
 * Granola was a refusal (connect again).
 */
export type GranolaKeyState = 'checking' | 'none' | 'set' | 'accepted' | 'refused';

/** Settings → Granola as it draws it. There is no key here to show. */
export interface GranolaView {
  readonly keyState: GranolaKeyState;
  /** Why whether a key is held could not be asked. */
  readonly keyProblem: string | null;
  /** A key is being saved or forgotten. */
  readonly pending: boolean;
  readonly importing: boolean;
  /** True until sync has pulled the vault this session: nothing is imported before then. */
  readonly waiting: boolean;
  readonly automatic: boolean;
  /** When this Mac last finished an import of the vault. */
  readonly lastImportAt: Date | null;
  /** What it did, in a few words. */
  readonly lastResult: string | null;
  /** The meetings the last import did not write. */
  readonly problems: readonly GranolaNoteProblem[];
  /** Why the last import stopped or failed, or a key change failed. */
  readonly problem: string | null;
  /** Meetings whose notes the person deleted, which imports leave out. */
  readonly dismissed: number;
}

/** Whether sync has pulled the vault this session (or found it does not sync), and word when that changes. */
export interface SyncReadiness {
  isReady(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface GranolaImporterDeps {
  readonly granola: GranolaPort;
  readonly records: GranolaRecords;
  readonly vault: VaultDeps;
  /** The vault's folder, as the host names it. */
  readonly vaultKey: string;
  readonly clock: Clock;
  readonly timers: SyncTimers;
  readonly timeZone: string;
  readonly selfEmails: readonly string[];
  readonly sync: SyncReadiness;
}

/** What the UI may ask of the Granola import. */
export interface GranolaControls {
  getView(): GranolaView;
  subscribe(listener: () => void): () => void;
  /** Keeps the key in this Mac's Keychain; Granola checks it once. The field's text goes nowhere else. */
  connect(key: string): Promise<void>;
  disconnect(): Promise<void>;
  importNow(): void;
  setAutomatic(on: boolean): void;
  /** Lets the meetings whose notes the person deleted be imported again, and imports now. */
  importDeletedAgain(): void;
  /** Hears the quiet notices: meetings arrived, the key was refused, an Import now failed. */
  onNotice(listener: (text: string) => void): () => void;
}

function problemOf(cause: unknown): string {
  if (cause instanceof GranolaError) return granolaFailureWords(cause.failure);
  return cause instanceof Error ? cause.message : String(cause);
}

/** The key state a status from the host means; `accepted` when it answers a new key Granola took. */
function keyStateOf(status: GranolaKeyStatus, fresh: boolean): GranolaKeyState {
  if (!status.hasKey) return 'none';
  if (status.lastRefusal !== null) return 'refused';
  return fresh ? 'accepted' : 'set';
}

/**
 * The Granola import of the open vault, as DFAI schedules it: once as the
 * vault opens, every 15 minutes while automatic import is on, and on Import
 * now — and only once sync has pulled the vault this session, and while this
 * Mac holds a key Granola has not refused. One import at a time: Import now
 * pressed during an automatic one runs right after it, once.
 */
export function createGranolaImporter(
  deps: GranolaImporterDeps,
): GranolaControls & { start(): void; stop(): void } {
  const listeners = new Set<() => void>();
  const noticeListeners = new Set<(text: string) => void>();
  const record = (): GranolaRecord => deps.records.read(deps.vaultKey);
  const dismissedNow = () =>
    readImportLedger(deps.vault.session).ledger.filter(
      (entry) => entry.provider === 'granola' && entry.dismissed,
    ).length;
  const kept = record();
  let view: GranolaView = {
    ...{ keyState: 'checking', keyProblem: null, pending: false, importing: false },
    ...{ waiting: !deps.sync.isReady(), automatic: kept.automatic, problems: [] },
    lastImportAt: kept.lastImportAt === null ? null : new Date(kept.lastImportAt),
    ...{ lastResult: kept.lastResult, problem: null, dismissed: dismissedNow() },
  };
  const update = (change: Partial<GranolaView>) => {
    view = { ...view, ...change };
    for (const listener of listeners) listener();
  };
  const notice = (text: string | null) => {
    if (text !== null) for (const listener of noticeListeners) listener(text);
  };
  const usable = () => view.keyState === 'set' || view.keyState === 'accepted';
  const vault = deps.vaultKey;
  const wait = (ms: number) => new Promise<void>((resolve) => deps.timers.after(ms, resolve));

  let running: { mode: GranolaPullMode; done: Promise<void> } | null = null;
  let queued = false;
  let startedOnce = false;
  let cancelTimer: (() => void) | null = null;
  let stopped = false;

  /** Asks the host again; a key Granola just accepted stays `accepted` while nothing refused it. */
  const readKey = async () => {
    try {
      const status = await deps.granola.status({ vault });
      update({ keyState: keyStateOf(status, view.keyState === 'accepted'), keyProblem: null });
    } catch (cause) {
      update({ keyProblem: problemOf(cause) });
    }
  };

  const keep = (report: GranolaImportReport) => {
    const line = granolaReportLine(report);
    const at = deps.clock.now();
    const next: GranolaRecord = {
      ...record(),
      watermark: report.watermark,
      lastImportAt: at.toISOString(),
      lastResult: line,
    };
    deps.records.write(vault, next);
    update({ lastImportAt: at, lastResult: line, problems: report.problems });
    update({ problem: report.problem, dismissed: dismissedNow() });
  };

  const tell = (report: GranolaImportReport, mode: GranolaPullMode) => {
    notice(granolaArrivalNotice(report.counts));
    if (report.keyRefused) notice(report.problem);
    else if (mode === 'import-now' && report.ended !== 'imported') notice(report.problem);
  };

  const runOnce = async (mode: GranolaPullMode) => {
    update({ importing: true });
    try {
      const report = await importGranolaMeetings(
        { ...deps, wait },
        { mode, watermark: record().watermark },
      );
      keep(report);
      tell(report, mode);
    } catch (cause) {
      // A fault outside Granola's own failures (the disk, the ledger): said on the card and kept going.
      update({ problem: problemOf(cause) });
    } finally {
      update({ importing: false });
    }
    await readKey();
  };

  const pull = (mode: GranolaPullMode): Promise<void> => {
    if (running !== null) {
      if (mode === 'import-now' && running.mode !== 'import-now') queued = true;
      return running.done;
    }
    if (!deps.sync.isReady()) {
      update({ waiting: true });
      return Promise.resolve();
    }
    const done = runOnce(mode).finally(() => {
      running = null;
      if (queued) {
        queued = false;
        void pull('import-now');
      }
    });
    running = { mode, done };
    return done;
  };

  const schedule = () => {
    cancelTimer?.();
    cancelTimer = null;
    if (stopped || !view.automatic || !usable()) return;
    cancelTimer = deps.timers.after(GRANOLA_IMPORT_EVERY_MS, () => {
      void pull('periodic').finally(schedule);
    });
  };

  /** The import as the vault opens: once a sync has pulled it and the key is usable. */
  const maybeStart = () => {
    const ready = deps.sync.isReady();
    if (view.waiting === ready) update({ waiting: !ready });
    if (startedOnce || stopped || !ready || !usable() || !view.automatic) return;
    startedOnce = true;
    void pull('startup');
    schedule();
  };

  let unsubscribeSync: (() => void) | null = null;

  return {
    getView: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onNotice(listener) {
      noticeListeners.add(listener);
      return () => noticeListeners.delete(listener);
    },
    start() {
      unsubscribeSync = deps.sync.subscribe(maybeStart);
      void readKey().then(maybeStart);
    },
    stop() {
      stopped = true;
      unsubscribeSync?.();
      cancelTimer?.();
    },
    async connect(key) {
      update({ pending: true, problem: null });
      try {
        const status = await deps.granola.setKey({ vault, key });
        update({ keyState: keyStateOf(status, true), keyProblem: null });
        if (status.lastRefusal !== null) notice('Granola refused this key.');
        startedOnce = false;
        maybeStart();
      } catch (cause) {
        update({ problem: problemOf(cause) });
      } finally {
        update({ pending: false });
      }
    },
    async disconnect() {
      update({ pending: true, problem: null });
      try {
        const status = await deps.granola.forgetKey({ vault });
        update({ keyState: keyStateOf(status, false) });
        schedule();
      } catch (cause) {
        update({ problem: problemOf(cause) });
      } finally {
        update({ pending: false });
      }
    },
    importNow() {
      void pull('import-now');
    },
    setAutomatic(on) {
      deps.records.write(vault, { ...record(), automatic: on });
      update({ automatic: on });
      if (on) maybeStart();
      schedule();
    },
    importDeletedAgain() {
      const { ledger } = readImportLedger(deps.vault.session);
      void writeImportLedger(deps.vault, restoreDismissed(ledger, 'granola'))
        .then(() => {
          update({ dismissed: dismissedNow() });
          return pull('import-now');
        })
        .catch((cause: unknown) => update({ problem: problemOf(cause) }));
    },
  };
}
