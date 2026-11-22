import { buildAiIndex } from '../../domain/ai-index/index.ts';
import { IMPORTS_PATH, parseImportLedger } from '../../domain/meetings/index.ts';
import { VaultSession } from '../session/index.ts';
import {
  FakeGranola,
  FixedClock,
  fictionalGranolaNote,
  granolaRefusal,
  MemoryVaultFiles,
} from '../testing/index.ts';
import { applyExternalChanges, deleteNote, openVault, renameNote } from '../use-cases/index.ts';
import { GranolaError } from './ports.ts';
import { importGranolaMeetings, type GranolaImportDeps } from './import-granola-meetings.ts';

const PATH = 'Meetings/2026/11/2026-11-17 Larkspur Payroll renewal.md';
const URL = 'https://notes.granola.ai/d/5f1e7c2a-0b3d-4e6f-9a8b-1c2d3e4f5a6b';

let files: MemoryVaultFiles;
let session: VaultSession;
let granola: FakeGranola;
let deps: GranolaImportDeps;

async function open(texts: Record<string, string> = { 'Inbox/Welcome.md': 'Hello.\n' }) {
  files = MemoryVaultFiles.of(texts);
  session = new VaultSession();
  await openVault({ files, session });
  deps = {
    vault: { files, session },
    granola,
    vaultKey: '/Users/example/Notes',
    clock: new FixedClock(new Date('2026-11-20T00:00:00Z')),
    wait: async () => undefined,
    timeZone: 'America/Los_Angeles',
    selfEmails: [],
  };
}

const importNow = (watermark: string | null = null) =>
  importGranolaMeetings(deps, { mode: 'import-now', watermark });

const ledger = () => parseImportLedger(files.peek(IMPORTS_PATH) ?? '').ledger;

beforeEach(async () => {
  granola = new FakeGranola().add(fictionalGranolaNote());
  await open();
});

describe('importing Granola meetings', () => {
  it('writes a new meeting as a note at its contract path, and records it in the ledger', async () => {
    const report = await importNow();
    expect(report).toMatchObject({ ended: 'imported', written: [PATH], problems: [] });
    expect(report.counts).toEqual({ imported: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0 });
    expect(report.watermark).toBe('2026-11-17T17:41:03.000Z');
    const text = files.peek(PATH) ?? '';
    expect(text).toContain('- With: [[Mara Quill]], [[Tobias Fenn]]');
    expect(text).toContain(`- Source: ${URL}`);
    expect(text).toContain('## Transcript');
    expect(ledger()).toEqual([
      {
        provider: 'granola',
        id: 'not_Lk7pQ2rTs9vWx3',
        path: PATH,
        source: URL,
        updatedAt: '2026-11-17T17:41:03Z',
        dismissed: false,
      },
    ]);
  });

  it('lands in the AI index’s meetings for its month: date, title, people, first sentence', async () => {
    await importNow();
    const index = buildAiIndex((await files.readAll()).notes);
    const month = index.find(({ path }) => path === '_index/meetings/2026-11.md')?.text ?? '';
    const line = month.split('\n').find((each) => each.startsWith('2026-11-17'));
    expect(line).toContain('Larkspur Payroll renewal');
    expect(line).toContain('[[Mara Quill]]');
    expect(line).toContain('[[Tobias Fenn]]');
    expect(line).toContain('Larkspur Payroll renews at the current price with a sixty-day notice');
  });

  it('asks again for nothing it already has: an unchanged meeting is not fetched or written', async () => {
    await importNow();
    const [note, ledgerText] = [files.peek(PATH), files.peek(IMPORTS_PATH)];
    granola.calls.length = 0;
    const report = await importNow();
    expect(report.counts.unchanged).toBe(1);
    expect(report.written).toEqual([]);
    expect(granola.calls.some((call) => call.startsWith('get'))).toBe(false);
    expect(files.peek(PATH)).toBe(note);
    expect(files.peek(IMPORTS_PATH)).toBe(ledgerText);
  });

  it('merges a transcript that arrives later, once, leaving what the person wrote alone', async () => {
    granola.add(fictionalGranolaNote({ transcript: [] }));
    await importNow();
    const first = files.peek(PATH) ?? '';
    expect(first).not.toContain('## Transcript');
    const edited = first.replace('## Summary', 'My own line.\n\n## Summary');
    await files.write({ path: PATH, text: edited, expected: first });
    await applyExternalChanges({ files, session }, [PATH]);

    granola.add(fictionalGranolaNote({ updated_at: '2026-11-18T09:00:00Z' }));
    const report = await importNow();
    expect(report.counts.updated).toBe(1);
    const merged = files.peek(PATH) ?? '';
    expect(merged.startsWith(edited.trimEnd())).toBe(true);
    expect(merged.match(/## Transcript/g)).toHaveLength(1);

    granola.calls.length = 0;
    expect((await importNow()).counts.unchanged).toBe(1);
    expect(granola.calls.some((call) => call.startsWith('get'))).toBe(false);
  });

  it('does not import again a meeting whose note the person deleted, until asked', async () => {
    await importNow();
    await deleteNote({ files, session }, { path: PATH });
    expect(ledger()[0]?.dismissed).toBe(true);
    const report = await importNow();
    expect(report.counts).toMatchObject({ imported: 0, skipped: 1 });
    expect(files.peek(PATH)).toBeUndefined();
  });

  it('takes a note deleted outside the app as dismissed too', async () => {
    await importNow();
    files.drop(PATH);
    await applyExternalChanges({ files, session }, [PATH]);
    expect((await importNow()).counts.skipped).toBe(1);
    expect(files.peek(PATH)).toBeUndefined();
    expect(ledger()[0]?.dismissed).toBe(true);
  });

  it('follows a note the person renamed, and one moved outside the app, without a second note', async () => {
    await importNow();
    const renamed = 'Meetings/2026/11/Renewal call.md';
    expect((await renameNote({ files, session }, { from: PATH, to: renamed })).kind).toBe(
      'renamed',
    );
    expect(ledger()[0]?.path).toBe(renamed);
    granola.add(fictionalGranolaNote({ updated_at: '2026-11-18T09:00:00Z' }));
    expect((await importNow()).counts.unchanged).toBe(1);

    const text = files.peek(renamed) ?? '';
    files.drop(renamed);
    files.edit('Archive/Renewal call.md', text);
    await applyExternalChanges({ files, session }, [renamed, 'Archive/Renewal call.md']);
    granola.add(fictionalGranolaNote({ updated_at: '2026-11-19T09:00:00Z' }));
    const report = await importNow();
    expect(report.counts.imported).toBe(0);
    expect(files.peek(PATH)).toBeUndefined();
    expect(ledger()[0]?.path).toBe('Archive/Renewal call.md');
  });

  it('rebuilds a lost ledger from the notes’ Source lines rather than writing a second note', async () => {
    await importNow();
    files.drop(IMPORTS_PATH);
    await applyExternalChanges({ files, session }, [IMPORTS_PATH]);
    const report = await importNow();
    expect(report.counts).toMatchObject({ imported: 0, unchanged: 1 });
    expect(ledger()[0]?.path).toBe(PATH);
  });

  it('merges into the note another Mac wrote at the same path meanwhile: one note for one meeting', async () => {
    const other = new FakeGranola().add(fictionalGranolaNote());
    const otherFiles = MemoryVaultFiles.of({});
    const otherSession = new VaultSession();
    await openVault({ files: otherFiles, session: otherSession });
    await importGranolaMeetings(
      { ...deps, granola: other, vault: { files: otherFiles, session: otherSession } },
      { mode: 'import-now', watermark: null },
    );
    // The other Mac's note reaches this disk (a sync) before this Mac's session has read it.
    files.edit(PATH, otherFiles.peek(PATH) ?? '');
    const report = await importNow();
    expect(report.counts).toMatchObject({ imported: 0, unchanged: 1 });
    expect(files.peek(PATH)).toBe(otherFiles.peek(PATH));
    expect(
      (await files.readAll()).notes.filter(({ path }) => path.startsWith('Meetings/')),
    ).toHaveLength(1);
  });

  it('puts a second Granola meeting with the same title on the same day beside the first', async () => {
    granola.add(
      fictionalGranolaNote({ id: 'not_Second1', web_url: 'https://notes.granola.ai/d/second' }),
    );
    const report = await importNow();
    expect(report.counts.imported).toBe(2);
    expect(report.written).toHaveLength(2);
    expect(report.written).toContain(PATH);
    expect(report.written.find((path) => path !== PATH)).toMatch(
      /^Meetings\/2026\/11\/2026-11-17 Larkspur Payroll renewal \(granola [0-9a-f]{8}\)\.md$/,
    );
  });

  it('adds to the note n8n’s Gemini flow wrote for the same meeting, as the vault contract says', async () => {
    const gemini =
      'Renewal agreed. #meeting\n\n- When: 2026-11-17 10:00\n\n## Summary\n\nFrom Gemini.\n';
    await open({ [PATH]: gemini });
    const report = await importNow();
    expect(report.counts.updated).toBe(1);
    const text = files.peek(PATH) ?? '';
    expect(text.startsWith(gemini.trimEnd())).toBe(true);
    expect(text).toContain('## Notes');
    expect(text).toContain('## Transcript');
    expect(text.match(/## Summary/g)).toHaveLength(1);
  });

  it('reads every page of the list', async () => {
    granola.pageSize = 1;
    granola.add(fictionalGranolaNote({ id: 'not_B2', title: 'Tobias 1:1', web_url: null }));
    granola.add(fictionalGranolaNote({ id: 'not_C3', title: 'Mara 1:1', web_url: null }));
    const report = await importNow();
    expect(report.counts.imported).toBe(3);
    expect(granola.calls.filter((call) => call.startsWith('list'))).toHaveLength(3);
  });

  it('offline, writes nothing, keeps the watermark, and says to try later', async () => {
    granola.listFailure = new GranolaError({ kind: 'unreachable', message: 'offline' });
    const report = await importGranolaMeetings(deps, {
      mode: 'periodic',
      watermark: '2026-11-10T00:00:00.000Z',
    });
    expect(report).toMatchObject({ ended: 'failed', keyRefused: false, written: [] });
    expect(report.watermark).toBe('2026-11-10T00:00:00.000Z');
    expect(report.problem).toContain('The next import tries again.');
    expect(files.peek(IMPORTS_PATH)).toBeUndefined();
  });

  it('with a key Granola refused, touches nothing and says to connect again', async () => {
    granola.refused = true;
    const before = await files.readAll();
    const report = await importNow('2026-11-10T00:00:00.000Z');
    expect(report).toMatchObject({ ended: 'failed', keyRefused: true, written: [] });
    expect(report.problem).toContain('Granola refused the API key.');
    expect(report.watermark).toBe('2026-11-10T00:00:00.000Z');
    expect(await files.readAll()).toEqual(before);
  });

  it('leaves a meeting Granola keeps refusing for the next import, holding the watermark there', async () => {
    granola.add(fictionalGranolaNote({ id: 'not_Busy', updated_at: '2026-11-16T00:00:00Z' }));
    granola.noteFailures.set('not_Busy', granolaRefusal(503));
    const report = await importNow();
    expect(report.counts).toMatchObject({ imported: 1, failed: 1 });
    expect(report.watermark).toBe('2026-11-16T00:00:00.000Z');
    expect(report.problems[0]).toMatchObject({ id: 'not_Busy' });
  });

  it('asks again after a 429, five times, then counts the meeting failed', async () => {
    granola.noteFailures.set('not_Lk7pQ2rTs9vWx3', granolaRefusal(429));
    const report = await importNow();
    expect(granola.calls.filter((call) => call === 'get not_Lk7pQ2rTs9vWx3')).toHaveLength(6);
    expect(report.counts.failed).toBe(1);
    expect(report.problems[0]?.problem).toContain('slow down');
  });

  it('refuses by name a note it cannot map, and goes on to the next', async () => {
    granola.add(
      fictionalGranolaNote({ id: 'not_Odd', title: null, calendar_event: null, web_url: null }),
    );
    const report = await importNow();
    expect(report.counts).toMatchObject({ imported: 1, skipped: 1 });
    expect(report.problems[0]?.problem).toContain('title: missing');
  });
});
