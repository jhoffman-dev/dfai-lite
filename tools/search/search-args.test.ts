import { DEFAULT_LIMIT, parseSearchArgs, sinceMs } from './search-args.ts';

const NOW = new Date(2026, 10, 24, 15, 30).getTime();
const DAY = 86_400_000;

describe('reading the search command line', () => {
  it('joins the words into the query and reads every option', () => {
    const parsed = parseSearchArgs(
      [
        '"cutover date"',
        'mara',
        '--tag',
        'project',
        '--tag=#meeting',
        '--folder',
        'Projects',
        '--since',
        '7d',
        '--links-to',
        'Mara Quill',
        '--title',
        '--transcripts',
        '--limit',
        '25',
        '--vault',
        '/tmp/v',
      ],
      NOW,
    );
    expect(parsed).toEqual({
      kind: 'search',
      args: {
        query: '"cutover date" mara',
        filters: {
          tags: ['project', '#meeting'],
          folder: 'Projects',
          modifiedSinceMs: NOW - 7 * DAY,
          linksTo: 'Mara Quill',
          titleOnly: true,
          transcripts: true,
        },
        limit: 25,
        vault: '/tmp/v',
      },
    });
  });

  it('defaults to ten notes and no filters', () => {
    const parsed = parseSearchArgs(['ledger'], NOW);
    expect(parsed).toMatchObject({
      kind: 'search',
      args: { limit: DEFAULT_LIMIT, filters: { tags: [], titleOnly: false } },
    });
  });

  it('asks for help, and refuses what it cannot read', () => {
    expect(parseSearchArgs(['x', '-h'], NOW)).toEqual({ kind: 'help' });
    for (const argv of [
      ['--limit', '0'],
      ['--limit', '2.5'],
      ['--limit', '500'],
      ['--since', 'yesterday'],
      ['--tag'],
      ['--colour'],
    ]) {
      expect(parseSearchArgs(argv, NOW).kind).toBe('error');
    }
  });

  it('reads a date as the start of that local day, and refuses a day that does not exist', () => {
    expect(sinceMs('2026-11-01', NOW)).toBe(new Date(2026, 10, 1).getTime());
    expect(sinceMs('2026-02-30', NOW)).toBeNull();
    expect(sinceMs('0d', NOW)).toBe(NOW);
  });
});
