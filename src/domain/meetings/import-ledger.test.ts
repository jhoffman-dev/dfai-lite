import {
  findImport,
  importAtPath,
  IMPORTS_PATH,
  ledgerAfterDelete,
  ledgerAfterMove,
  parseImportLedger,
  recordImport,
  restoreDismissed,
  serializeImportLedger,
  type ImportEntry,
} from './import-ledger.ts';
import { meetingCopyPath, meetingSourceOf, shortHash } from './meeting-identity.ts';

const entry = (change: Partial<ImportEntry> = {}): ImportEntry => ({
  provider: 'granola',
  id: 'not_A1',
  path: 'Meetings/2026/11/2026-11-17 Larkspur Payroll renewal.md',
  source: 'https://notes.granola.ai/d/a1',
  updatedAt: '2026-11-17T17:41:03Z',
  dismissed: false,
  ...change,
});

describe('the import ledger', () => {
  it('lives in the app’s synced folder', () => {
    expect(IMPORTS_PATH).toBe('.dfai-lite/imports.json');
  });

  it('round-trips, sorted by provider and id, the same ledger always the same bytes', () => {
    const ledger = [
      entry({ id: 'not_B2', path: 'b.md' }),
      entry(),
      entry({ provider: 'gemini', id: 'z' }),
    ];
    const text = serializeImportLedger(ledger);
    expect(text).toBe(serializeImportLedger([...ledger].reverse()));
    expect(text.endsWith('}\n')).toBe(true);
    const parsed = parseImportLedger(text);
    expect(parsed.kind).toBe('ok');
    expect(parsed.ledger.map(({ provider, id }) => `${provider} ${id}`)).toEqual([
      'gemini z',
      'granola not_A1',
      'granola not_B2',
    ]);
    expect(parsed.ledger[1]).toEqual(entry());
  });

  it('writes `dismissed` only when it is true, keys in a fixed order', () => {
    const text = serializeImportLedger([entry({ dismissed: true })]);
    expect(text).toBe(
      [
        '{',
        '  "version": 1,',
        '  "meetings": [',
        '    {',
        '      "provider": "granola",',
        '      "id": "not_A1",',
        '      "path": "Meetings/2026/11/2026-11-17 Larkspur Payroll renewal.md",',
        '      "source": "https://notes.granola.ai/d/a1",',
        '      "updatedAt": "2026-11-17T17:41:03Z",',
        '      "dismissed": true',
        '    }',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
    expect(serializeImportLedger([entry()])).not.toContain('dismissed');
  });

  it('reads tolerantly: a bad entry is left out, the rest kept; text that is no ledger reads as empty, with why', () => {
    const text = JSON.stringify({
      version: 1,
      meetings: [entry(), { provider: 'granola' }, 7, entry({ id: 'not_A1', path: 'later.md' })],
    });
    expect(parseImportLedger(text)).toEqual({
      kind: 'ok',
      ledger: [entry({ path: 'later.md' })],
    });
    expect(parseImportLedger('{oops')).toMatchObject({ kind: 'malformed', ledger: [] });
    expect(parseImportLedger('[]')).toMatchObject({ kind: 'malformed', ledger: [] });
  });

  it('finds a meeting by provider and id, and by its note’s path while it is not dismissed', () => {
    const ledger = recordImport([], entry());
    expect(findImport(ledger, { provider: 'granola', id: 'not_A1' })).toEqual(entry());
    expect(findImport(ledger, { provider: 'gemini', id: 'not_A1' })).toBeNull();
    expect(importAtPath(ledger, entry().path)).toEqual(entry());
    expect(importAtPath(ledgerAfterDelete(ledger, entry().path), entry().path)).toBeNull();
  });

  it('records a meeting once, the newer entry replacing the older', () => {
    const ledger = recordImport(recordImport([], entry()), entry({ updatedAt: 'later' }));
    expect(ledger).toEqual([entry({ updatedAt: 'later' })]);
  });

  it('follows a note renamed or a folder moved, as the favorites do', () => {
    const ledger = [entry(), entry({ id: 'not_B2', path: 'Inbox/Other.md' })];
    const renamed = ledgerAfterMove(ledger, { from: entry().path, to: 'Meetings/Renewal.md' });
    expect(renamed.map(({ path }) => path)).toEqual(['Meetings/Renewal.md', 'Inbox/Other.md']);
    const moved = ledgerAfterMove(ledger, { from: 'Meetings', to: 'Archive/Meetings' });
    expect(moved[0]?.path).toBe('Archive/Meetings/2026/11/2026-11-17 Larkspur Payroll renewal.md');
  });

  it('remembers a deleted note’s meeting as dismissed, until the person asks for them back', () => {
    const dismissed = ledgerAfterDelete([entry()], entry().path);
    expect(dismissed[0]?.dismissed).toBe(true);
    expect(ledgerAfterDelete([entry()], 'Inbox/Other.md')).toEqual([entry()]);
    expect(restoreDismissed(dismissed, 'gemini')).toEqual(dismissed);
    expect(restoreDismissed([...dismissed, entry({ id: 'kept' })], 'granola')).toEqual([
      entry({ id: 'kept' }),
    ]);
  });
});

describe('a meeting’s identity in its note', () => {
  it('reads the `- Source:` line before the first section, and nothing after', () => {
    const note = 'One. #meeting\n\n- When: 2026-11-17\n- Source: https://notes.granola.ai/d/a1\n';
    expect(meetingSourceOf(note)).toBe('https://notes.granola.ai/d/a1');
    expect(meetingSourceOf('One.\n\n## Notes\n\n- Source: https://example.com/x\n')).toBeNull();
  });

  it('names a second meeting at a taken path as DFAI does, the hash of provider and id', () => {
    expect(shortHash('granola\nnot_A1')).toMatch(/^[0-9a-f]{8}$/);
    expect(
      meetingCopyPath({ date: '2026-11-17', title: '1:1' }, { provider: 'granola', id: 'not_A1' }),
    ).toBe(`Meetings/2026/11/2026-11-17 1 1 (granola ${shortHash('granola\nnot_A1')}).md`);
  });
});
