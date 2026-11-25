import {
  isSearchedPath,
  isSkippedRootFolder,
  matchingLines,
  MAX_LINE_LENGTH,
  parseSearchQuery,
  searchNotes,
  type SearchableNote,
  type SearchFilters,
} from './index.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24);

const note = (path: string, text: string, daysAgo = 0): SearchableNote => ({
  path,
  text,
  modifiedMs: NOW - daysAgo * DAY,
});

const VAULT: readonly SearchableNote[] = [
  note(
    'Projects/Larkspur rollout.md',
    'The ledger move for Larkspur Payroll. #project/larkspur\n\n## Cutover\nMara Quill owns the cutover.\n',
    3,
  ),
  note(
    'People/Mara Quill.md',
    'Mara leads payroll at Larkspur Payroll. #person\nSee [[Larkspur rollout]].\n',
    10,
  ),
  note(
    'Meetings/2026/11/2026-11-20 Weekly sync.md',
    'Cutover date agreed. #meeting\n- With: [[Mara Quill]], [[Tobias Fenn]]\n',
    4,
  ),
  note('Inbox/Cutover worries.md', 'What if the payroll run slips? #project\n', 1),
  note(
    'Transcripts/2026/11/2026-11-20 Weekly sync (transcript).md',
    'Tobias Fenn: the cutover is on the 3rd.\n',
    4,
  ),
  note('attachments/notes.md', 'cutover cutover', 0),
  note('_index/README.md', 'cutover', 0),
  note('README.md', 'cutover', 0),
];

const search = (query: string, filters: SearchFilters = {}, limit = 10) =>
  searchNotes({ notes: VAULT, query, filters, limit });
const paths = (query: string, filters: SearchFilters = {}, limit = 10) =>
  search(query, filters, limit).hits.map(({ path }) => path);

describe('what a search reads', () => {
  it('skips generated, hidden, guide and attachment paths, and transcripts unless asked', () => {
    const scope = { transcripts: false };
    expect(isSearchedPath('Projects/Plan.md', scope)).toBe(true);
    for (const path of [
      '_index/README.md',
      '.dfai-lite/x.md',
      '.git/x.md',
      'README.md',
      'CLAUDE.md',
      'attachments/a.md',
      'Transcripts/a.md',
      'Plan.txt',
    ]) {
      expect(isSearchedPath(path, scope)).toBe(false);
    }
    expect(isSearchedPath('Transcripts/a.md', { transcripts: true })).toBe(true);
    expect(isSearchedPath('Projects/attachments/a.md', scope)).toBe(true);
  });

  it('leaves the same root folders unwalked', () => {
    const scope = { transcripts: false };
    expect(
      ['.git', '_index', '.dfai-lite', 'attachments', 'node_modules', 'Transcripts'].filter(
        (name) => isSkippedRootFolder(name, scope),
      ),
    ).toHaveLength(6);
    expect(isSkippedRootFolder('Transcripts', { transcripts: true })).toBe(false);
    expect(isSkippedRootFolder('Projects', scope)).toBe(false);
  });
});

describe('reading a query', () => {
  it('splits words, keeps quoted phrases whole, folds case and drops repeats', () => {
    expect(parseSearchQuery('Payroll "cutover  date" payroll ""')).toEqual([
      { folded: 'payroll', phrase: false },
      { folded: 'cutover  date', phrase: true },
    ]);
  });

  it('reads an unclosed quote as a plain word', () => {
    expect(parseSearchQuery('"cutover')).toEqual([{ folded: 'cutover', phrase: false }]);
  });

  it('composes accents so either spelling matches', () => {
    expect(parseSearchQuery('Zoë')).toEqual([{ folded: 'zoë', phrase: false }]);
  });
});

describe('ranking', () => {
  it('puts a title hit above a heading hit above body text', () => {
    expect(paths('cutover')).toEqual([
      'Inbox/Cutover worries.md',
      'Projects/Larkspur rollout.md',
      'Meetings/2026/11/2026-11-20 Weekly sync.md',
    ]);
  });

  it('breaks a tie by the most recently changed, then by path', () => {
    const tied = [note('B.md', 'ledger', 5), note('A.md', 'ledger', 5), note('C.md', 'ledger', 1)];
    expect(
      searchNotes({ notes: tied, query: 'ledger', limit: 10 }).hits.map(({ path }) => path),
    ).toEqual(['C.md', 'A.md', 'B.md']);
  });

  it('puts the note named exactly for the query first', () => {
    expect(paths('mara quill')[0]).toBe('People/Mara Quill.md');
  });

  it('needs every word, and a quoted phrase as written', () => {
    expect(paths('payroll cutover')).toEqual([
      'Inbox/Cutover worries.md',
      'Projects/Larkspur rollout.md',
    ]);
    expect(paths('"payroll run"')).toEqual(['Inbox/Cutover worries.md']);
    expect(paths('"run payroll"')).toEqual([]);
  });

  it('gives the same answer whatever order the notes come in', () => {
    const reversed = searchNotes({ notes: [...VAULT].reverse(), query: 'cutover', limit: 10 });
    expect(reversed).toEqual(search('cutover'));
  });

  it('caps the hits at the limit and still counts them all', () => {
    const result = search('cutover', {}, 1);
    expect(result.hits).toHaveLength(1);
    expect(result.total).toBe(3);
  });
});

describe('filters', () => {
  it('matches a tag and the tags under it, with or without #', () => {
    expect(paths('', { tags: ['#project'] })).toEqual([
      'Inbox/Cutover worries.md',
      'Projects/Larkspur rollout.md',
    ]);
    expect(paths('', { tags: ['project/larkspur'] })).toEqual(['Projects/Larkspur rollout.md']);
    expect(paths('', { tags: ['project', 'person'] })).toEqual([]);
  });

  it('keeps a folder and everything below it, minding no case', () => {
    expect(paths('', { folder: 'meetings/' })).toEqual([
      'Meetings/2026/11/2026-11-20 Weekly sync.md',
    ]);
    expect(paths('', { folder: 'Meet' })).toEqual([]);
  });

  it('keeps notes changed since a time, newest first', () => {
    expect(paths('', { modifiedSinceMs: NOW - 4 * DAY })).toEqual([
      'Inbox/Cutover worries.md',
      'Projects/Larkspur rollout.md',
      'Meetings/2026/11/2026-11-20 Weekly sync.md',
    ]);
  });

  it('finds backlinks by the app’s link rules, and says when no note answers', () => {
    expect(paths('', { linksTo: 'mara quill' })).toEqual([
      'Meetings/2026/11/2026-11-20 Weekly sync.md',
    ]);
    expect(paths('', { linksTo: '[[People/Mara Quill]]' })).toEqual([
      'Meetings/2026/11/2026-11-20 Weekly sync.md',
    ]);
    expect(search('', { linksTo: 'Tobias Fenn' })).toEqual({
      total: 0,
      hits: [],
      unknownLinkTarget: 'Tobias Fenn',
    });
  });

  it('matches names only with titleOnly, and shows no lines', () => {
    const result = search('sync', { titleOnly: true });
    expect(result.hits.map(({ path }) => path)).toEqual([
      'Meetings/2026/11/2026-11-20 Weekly sync.md',
    ]);
    expect(result.hits[0]?.lines).toEqual([]);
    expect(paths('payroll', { titleOnly: true })).toEqual([]);
  });

  it('searches transcripts only when asked', () => {
    expect(paths('"on the 3rd"')).toEqual([]);
    expect(paths('"on the 3rd"', { transcripts: true })).toEqual([
      'Transcripts/2026/11/2026-11-20 Weekly sync (transcript).md',
    ]);
  });
});

describe('what a hit shows', () => {
  it('gives tags, matching lines with numbers, and a summary only when there are no lines', () => {
    const [rollout] = search('mara cutover', { folder: 'Projects' }).hits;
    expect(rollout).toMatchObject({
      title: 'Larkspur rollout',
      tags: ['project/larkspur'],
      lines: [
        { line: 3, text: '## Cutover' },
        { line: 4, text: 'Mara Quill owns the cutover.' },
      ],
      summary: '',
    });
    const [listed] = search('', { folder: 'Projects' }).hits;
    expect(listed?.summary).toBe('The ledger move for Larkspur Payroll.');
  });

  it('shows at most three lines: the fullest first, kept in note order', () => {
    const text = ['a ledger', 'ledger move', 'b ledger', '# Ledger', 'ledger move again'].join(
      '\n',
    );
    expect(matchingLines(text, parseSearchQuery('ledger move'), 3).map(({ line }) => line)).toEqual(
      [2, 4, 5],
    );
  });

  it('cuts a long line around its match', () => {
    const long = `${'x'.repeat(300)} ledger ${'y'.repeat(300)}`;
    const text = matchingLines(long, parseSearchQuery('ledger'), 1)[0]?.text ?? '';
    expect(text.length).toBe(MAX_LINE_LENGTH);
    expect(text).toContain('ledger');
    expect(text.startsWith('…') && text.endsWith('…')).toBe(true);
  });
});
