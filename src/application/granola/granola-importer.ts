import {
  granolaArrivalNotice,
  granolaFailureWords,
  granolaReportLine,
  type GranolaPullMode,
} from '../../domain/granola/index.ts';
import { IMPORTS_PATH, restoreDismissed } from '../../domain/meetings/index.ts';
import type { Clock } from '../ports/index.ts';
import type { VaultChange } from '../session/index.ts';
import type { SyncTimers } from '../sync/index.ts';
import {
  importLedgerProblem,
  readImportLedger,
  replaceImportLedger,
  updateImportLedger,
  type VaultDeps,
} from '../use-cases/index.ts';
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
  /** Why the import ledger cannot be read: imports wait for the person's choice. Null when it can. */
  readonly ledgerProblem: string | null;
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
  /**
   * For a ledger that cannot be read: replaces it, then imports now, which
   * links each meeting again to the note carrying its `- Source:` line. The
   * meetings the person had deleted cannot be told from the rest: they come back.
   */
  rebuildLedger(): void;
  /** For a ledger that cannot be read: replaces it with an empty one; the next import relinks by Source lines. */
  startEmptyLedger(): void;
  /** Hears the quiet notices: meetings arrived, the key was refused, an Import now failed. */
  onNotice(listener: (text: string) => void): () => void;
}

function problemOf(cause: unknown): string {
  if (cause instanceof GranolaError) return granolaFailureWords(cause.failure);
  return cause instanceof Error ? cause.message : String(cause);
}

/** A key as pasted: a copied `Authorization` value's `Bearer ` taken off. */
export const pastedKey = (text: string): string => text.trim().replace(/^Bearer\s+/i, '');

/**
 * The key state a status from the host means. A refusal this Mac remembers
 * from an earlier session stands until a new key, or an answer, says otherwise.
 */
function keyStateOf(
  status: GranolaKeyStatus,
  { fresh, refusedBefore }: { fresh: boolean; refusedBefore: boolean },
): GranolaKeyState {
  if (!status.hasKey) return 'none';
  if (status.lastRefusal !== null || refusedBefore) return 'refused';
  return fresh ? 'accepted' : 'set';
}

const touchesLedger = (change: VaultChange) =>
  change.kind === 'loaded' ||
  ((change.kind === 'written' || change.kind === 'deleted') && change.path === IMPORTS_PATH) ||
  (change.kind === 'renamed' && (change.from === IMPORTS_PATH || change.to === IMPORTS_PATH));

/**
 * The Granola import of the open vault, as DFAI schedules it: once as the
 * vault opens, every 15 minutes while automatic import is on, and on Import
 * now — and only once sync has pulled the vault this session, while this
 * Mac holds a key Granola has not refused, and while the import ledger can
 * be read. One import at a time: Import now pressed during an automatic one
 * runs right after it, once.
 */
export function createGranolaImporter(
  deps: GranolaImporterDeps,
): GranolaControls & { start(): void; stop(): void } {
  const { session } = deps.vault;
  const vault = deps.vaultKey;
  const listeners = new Set<() => void>();
  const noticeListeners = new Set<(text: string) => void>();
  const record = (): GranolaRecord => deps.records.read(vault);
  const keepRecord = (change: Partial<GranolaRecord>) =>
    deps.records.write(vault, { ...record(), ...change });
  const ledgerState = () => ({
    ledgerProblem: importLedgerProblem(session),
    dismissed: readImportLedger(session).ledger.filter(
      (entry) => entry.provider === 'granola' && entry.dismissed,
    ).length,
  });
  const kept = record();
  let view: GranolaView = {
    ...{ keyState: 'checking', keyProblem: null, pending: false, importing: false },
    ...{ waiting: !deps.sync.isReady(), automatic: kept.automatic, problems: [] },
    lastImportAt: kept.lastImportAt === null ? null : new Date(kept.lastImportAt),
    ...{ lastResult: kept.lastResult, problem: null, ...ledgerState() },
  };
  const update = (change: Partial<GranolaView>) => {
    view = { ...view, ...change };
    for (const listener of listeners) listener();
  };
  const notice = (text: string | null) => {
    if (text !== null) for (const listener of noticeListeners) listener(text);
  };
  const usable = () => view.keyState === 'set' || view.keyState === 'accepted';
  const wait = (ms: number) => new Promise<void>((resolve) => deps.timers.after(ms, resolve));

  let running: { mode: GranolaPullMode; done: Promise<void> } | null = null;
  let queued = false;
  let startedOnce = false;
  let cancelTimer: (() => void) | null = null;
  let stopped = false;

  /** Granola refused the key: said once, kept so a later launch neither imports nor says it again. */
  const refusedNow = (words: string | null) => {
    if (record().keyRefusedAt === null) notice(words);
    keepRecord({ keyRefusedAt: record().keyRefusedAt ?? deps.clock.now().toISOString() });
    update({ keyState: 'refused' });
  };

  /** Asks the host again; a key Granola just accepted stays `accepted` while nothing refused it. */
  const readKey = async () => {
    try {
      const status = await deps.granola.status({ vault });
      if (!status.hasKey) keepRecord({ keyRefusedAt: null });
      const refusedBefore = record().keyRefusedAt !== null;
      const fresh = view.keyState === 'accepted';
      update({ keyState: keyStateOf(status, { fresh, refusedBefore }), keyProblem: null });
    } catch (cause) {
      update({ keyProblem: problemOf(cause) });
    }
  };

  const keep = (report: GranolaImportReport) => {
    const line = granolaReportLine(report);
    const at = deps.clock.now();
    keepRecord({ watermark: report.watermark, lastImportAt: at.toISOString(), lastResult: line });
    update({ lastImportAt: at, lastResult: line, problems: report.problems });
    update({ problem: report.problem, ...ledgerState() });
  };

  const tell = (report: GranolaImportReport, mode: GranolaPullMode) => {
    notice(granolaArrivalNotice(report.counts));
    if (report.keyRefused) refusedNow(report.problem);
    else if (mode === 'import-now' && report.ended !== 'imported') notice(report.problem);
    if (report.ended === 'imported') keepRecord({ keyRefusedAt: null });
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
      // A fault outside Granola's own failures (the disk): said on the card and kept going.
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
    // An unreadable ledger waits for the person's choice in Settings, which shows it.
    if (importLedgerProblem(session) !== null) return Promise.resolve();
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

  /** Replaces an unreadable ledger at the person's word, then maybe imports. */
  const replaceLedger = (thenImport: boolean) => {
    void replaceImportLedger(deps.vault, [])
      .then(() => {
        update({ problem: null, ...ledgerState() });
        return thenImport ? pull('import-now') : undefined;
      })
      .catch((cause: unknown) => update({ problem: problemOf(cause) }));
  };

  const stops: (() => void)[] = [];

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
      stops.push(deps.sync.subscribe(maybeStart));
      stops.push(
        session.subscribe((change) => {
          if (touchesLedger(change)) update(ledgerState());
        }),
      );
      void readKey().then(maybeStart);
    },
    stop() {
      stopped = true;
      for (const unsubscribe of stops) unsubscribe();
      cancelTimer?.();
    },
    async connect(pasted) {
      update({ pending: true, problem: null });
      try {
        const status = await deps.granola.setKey({ vault, key: pastedKey(pasted) });
        keepRecord({ keyRefusedAt: null });
        const state = keyStateOf(status, { fresh: true, refusedBefore: false });
        update({ keyState: state, keyProblem: null });
        if (state === 'refused') refusedNow('Granola refused this key.');
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
        keepRecord({ keyRefusedAt: null });
        update({ keyState: keyStateOf(status, { fresh: false, refusedBefore: false }) });
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
      keepRecord({ automatic: on });
      update({ automatic: on });
      if (on) maybeStart();
      schedule();
    },
    importDeletedAgain() {
      void updateImportLedger(deps.vault, (ledger) => restoreDismissed(ledger, 'granola'))
        .then(() => {
          update(ledgerState());
          return pull('import-now');
        })
        .catch((cause: unknown) => update({ problem: problemOf(cause) }));
    },
    rebuildLedger: () => replaceLedger(true),
    startEmptyLedger: () => replaceLedger(false),
  };
}
