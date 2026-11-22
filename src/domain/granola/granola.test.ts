import {
  backoff,
  granolaArrivalNotice,
  granolaCountsLine,
  granolaFailureEffect,
  granolaFailureWords,
  granolaReportLine,
  isKeyRefused,
  nextWatermark,
  paceOf,
  sinceOf,
  transcriptOverLimit,
  type GranolaFailure,
} from './index.ts';

const refused = (status: number, transcriptPage = false): GranolaFailure => ({
  kind: 'api_refused',
  status,
  message: '',
  transcriptPage,
});

describe('the pace', () => {
  it('sends four a second, then waits until the fourth newest is a second old', () => {
    expect(paceOf({ sentAt: [0, 100, 200], now: 300 })).toBe(0);
    expect(paceOf({ sentAt: [0, 100, 200, 300], now: 300 })).toBe(700);
    expect(paceOf({ sentAt: [0, 100, 200, 300], now: 1200 })).toBe(0);
  });

  it('backs off 1, 2, 4, 8, 16 seconds after a 429, then gives up', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoff)).toEqual([1000, 2000, 4000, 8000, 16000, null]);
  });
});

describe('the watermark', () => {
  const now = Date.parse('2026-11-20T00:00:00Z');

  it('lists a day before it on the timer, and everything for Import now or a first import', () => {
    const watermark = '2026-11-18T12:00:00.000Z';
    expect(sinceOf({ watermark, mode: 'periodic' })).toBe('2026-11-17T12:00:00.000Z');
    expect(sinceOf({ watermark, mode: 'startup' })).toBe('2026-11-17T12:00:00.000Z');
    expect(sinceOf({ watermark, mode: 'import-now' })).toBeNull();
    expect(sinceOf({ watermark: null, mode: 'periodic' })).toBeNull();
    expect(sinceOf({ watermark: 'garbage', mode: 'periodic' })).toBeNull();
  });

  it('moves to the newest settled note, never past a failed one, nor past now', () => {
    const settled = { outcome: 'imported', updatedAt: '2026-11-19T00:00:00Z' } as const;
    const failed = { outcome: 'failed', updatedAt: '2026-11-18T00:00:00Z' } as const;
    const future = { outcome: 'unchanged', updatedAt: '2027-01-01T00:00:00Z' } as const;
    expect(nextWatermark({ watermark: null, results: [settled], now })).toBe(
      '2026-11-19T00:00:00.000Z',
    );
    expect(nextWatermark({ watermark: null, results: [settled, failed], now })).toBe(
      '2026-11-18T00:00:00.000Z',
    );
    expect(nextWatermark({ watermark: null, results: [future], now })).toBe(
      '2026-11-20T00:00:00.000Z',
    );
    const unreadable = { outcome: 'failed', updatedAt: 'x' } as const;
    expect(nextWatermark({ watermark: null, results: [settled, unreadable], now })).toBeNull();
  });
});

describe('a failure', () => {
  it('stops for no key and a refused key, retries what may pass, skips the rest', () => {
    expect(granolaFailureEffect({ kind: 'no_key', message: '' })).toBe('stop');
    expect(granolaFailureEffect(refused(401))).toBe('stop');
    expect(granolaFailureEffect({ kind: 'unreachable', message: '' })).toBe('retry');
    expect(granolaFailureEffect({ kind: 'timeout', message: '' })).toBe('retry');
    for (const status of [408, 429, 500, 503, 413]) {
      expect(granolaFailureEffect(refused(status))).toBe('retry');
    }
    expect(granolaFailureEffect(refused(413, true))).toBe('skip');
    expect(granolaFailureEffect(refused(404))).toBe('skip');
    expect(granolaFailureEffect({ kind: 'malformed', message: '' })).toBe('skip');
  });

  it('says a refused key needs a new one, and offline is a quiet try-later', () => {
    expect(isKeyRefused(refused(401))).toBe(true);
    expect(isKeyRefused(refused(403))).toBe(false);
    expect(granolaFailureWords(refused(401))).toContain('Granola refused the API key.');
    expect(granolaFailureWords({ kind: 'unreachable', message: 'dns' }, 'listing')).toBe(
      'Granola could not be reached. Check the connection. The next import tries again.',
    );
  });
});

describe('the report', () => {
  const none = { imported: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };

  it('counts what an import did in a line', () => {
    expect(granolaCountsLine(none)).toBe('Nothing new.');
    expect(granolaCountsLine({ ...none, imported: 2, updated: 1, unchanged: 14, failed: 1 })).toBe(
      'Imported 2 meetings, updated 1 meeting; 14 already here, 1 failed.',
    );
    expect(granolaReportLine({ ended: 'not-synced', counts: none, problem: null })).toBe(
      'Waiting for the vault to sync first.',
    );
    expect(granolaReportLine({ ended: 'failed', counts: none, problem: 'Offline.' })).toBe(
      'Nothing new. Offline.',
    );
  });

  it('notices only meetings that arrived', () => {
    expect(granolaArrivalNotice(none)).toBeNull();
    expect(granolaArrivalNotice({ ...none, imported: 1 })).toBe('A meeting arrived from Granola.');
    expect(granolaArrivalNotice({ ...none, imported: 3, updated: 2 })).toBe(
      '3 meetings arrived from Granola.',
    );
  });
});

describe('the transcript limit', () => {
  it('holds a transcript to five million characters or 500 pages', () => {
    expect(transcriptOverLimit({ characters: 5_000_000, pages: 500 })).toBe(false);
    expect(transcriptOverLimit({ characters: 5_000_001, pages: 1 })).toBe(true);
    expect(transcriptOverLimit({ characters: 0, pages: 501 })).toBe(true);
  });
});
