import {
  appearancesAfterDelete,
  appearancesAfterMove,
  isSingleEmoji,
  parseAppearances,
  pruneAppearances,
  resolveAppearance,
  serializeAppearances,
  setAppearance,
  type Appearances,
} from './index.ts';

const looks = (entries: Record<string, { color?: string; icon?: string }>): Appearances =>
  new Map(Object.entries(entries));

describe('reading and writing appearance.json', () => {
  it('reads a map of paths to looks, keeping only string fields', () => {
    const parsed = parseAppearances(
      '{"Projects": {"color": "blue", "icon": "work", "size": 3}, "A.md": {"icon": 7}, "B.md": "x"}',
    );
    expect(parsed.kind).toBe('ok');
    expect([...parsed.appearances]).toEqual([['Projects', { color: 'blue', icon: 'work' }]]);
  });

  it('reads malformed text as no looks, and says why', () => {
    expect(parseAppearances('{not json')).toMatchObject({ kind: 'malformed' });
    expect(parseAppearances('["A.md"]')).toMatchObject({ kind: 'malformed' });
    expect(parseAppearances('null')).toMatchObject({ kind: 'malformed' });
    expect(parseAppearances('{not json').appearances.size).toBe(0);
  });

  it('writes sorted paths, one per line, fields in a fixed order, and reads them back', () => {
    const text = serializeAppearances(
      looks({
        'Projects/Plan.md': { icon: 'flag', color: 'red' },
        '2026': { color: 'green' },
        Areas: { icon: 'home' },
      }),
    );
    expect(text).toBe(
      '{\n  "2026": {"color":"green"},\n  "Areas": {"icon":"home"},\n  "Projects/Plan.md": {"color":"red","icon":"flag"}\n}\n',
    );
    expect(serializeAppearances(parseAppearances(text).appearances)).toBe(text);
  });

  it('writes the same bytes whatever order the looks were set in', () => {
    const one = setAppearance(setAppearance(new Map(), 'B.md', { color: 'red' }), 'A.md', {
      icon: 'star',
    });
    const two = setAppearance(setAppearance(new Map(), 'A.md', { icon: 'star' }), 'B.md', {
      color: 'red',
    });
    expect(serializeAppearances(one)).toBe(serializeAppearances(two));
    expect(serializeAppearances(new Map())).toBe('{}\n');
  });

  it('keeps names this version does not know, in the file, for a newer app', () => {
    const text = '{\n  "A.md": {"color":"teal","icon":"rocket"}\n}\n';
    const { appearances } = parseAppearances(text);
    expect(serializeAppearances(appearances)).toBe(text);
    expect(resolveAppearance(appearances.get('A.md') ?? {})).toEqual({ hue: null, icon: null });
  });
});

describe('changing a look', () => {
  it('sets and clears each field on its own, dropping a look left with neither', () => {
    const colored = setAppearance(new Map(), 'A.md', { color: 'blue' });
    const both = setAppearance(colored, 'A.md', { icon: 'idea' });
    expect(both.get('A.md')).toEqual({ color: 'blue', icon: 'idea' });
    expect(setAppearance(both, 'A.md', { color: null }).get('A.md')).toEqual({ icon: 'idea' });
    expect(setAppearance(both, 'A.md', { color: null, icon: null }).has('A.md')).toBe(false);
    expect(colored.has('A.md')).toBe(true);
  });

  it('follows a note that was renamed or moved', () => {
    const before = looks({ 'Inbox/A.md': { color: 'red' }, 'B.md': { icon: 'star' } });
    const after = appearancesAfterMove(before, { from: 'Inbox/A.md', to: 'Work/Alpha.md' });
    expect([...after.keys()].sort()).toEqual(['B.md', 'Work/Alpha.md']);
    expect(after.get('Work/Alpha.md')).toEqual({ color: 'red' });
  });

  it('follows a folder that moved: its own look and every look under it', () => {
    const before = looks({
      Projects: { color: 'blue' },
      'Projects/Plan.md': { icon: 'flag' },
      'Projects/Old/Notes.md': { color: 'gray' },
      'Projects 2/Other.md': { color: 'pink' },
    });
    const after = appearancesAfterMove(before, { from: 'Projects', to: 'Areas/Work' });
    expect(Object.fromEntries(after)).toEqual({
      'Areas/Work': { color: 'blue' },
      'Areas/Work/Plan.md': { icon: 'flag' },
      'Areas/Work/Old/Notes.md': { color: 'gray' },
      'Projects 2/Other.md': { color: 'pink' },
    });
  });

  it('lets a moved look win over a stale one at the path it moved to', () => {
    const before = looks({ 'A.md': { color: 'red' }, 'B.md': { color: 'green' } });
    expect(appearancesAfterMove(before, { from: 'A.md', to: 'B.md' }).get('B.md')).toEqual({
      color: 'red',
    });
  });

  it('drops a deleted note, or a deleted folder with everything under it', () => {
    const before = looks({
      Projects: { color: 'blue' },
      'Projects/Plan.md': { icon: 'flag' },
      'Projects 2.md': { icon: 'star' },
    });
    expect([...appearancesAfterDelete(before, 'Projects').keys()]).toEqual(['Projects 2.md']);
    expect([...appearancesAfterDelete(before, 'Projects/Plan.md').keys()]).toEqual([
      'Projects',
      'Projects 2.md',
    ]);
  });

  it('prunes only gone paths within what was removed', () => {
    const before = looks({
      Projects: { color: 'blue' },
      'Projects/Kept.md': { icon: 'flag' },
      'Projects/Gone.md': { icon: 'star' },
      'Elsewhere/Unsynced.md': { color: 'red' },
    });
    const exists = (path: string) => path === 'Projects' || path === 'Projects/Kept.md';
    expect([...pruneAppearances(before, { within: 'Projects', exists }).keys()]).toEqual([
      'Projects',
      'Projects/Kept.md',
      'Elsewhere/Unsynced.md',
    ]);
  });
});

describe('drawing a look', () => {
  it('draws known hues and glyphs, and a single emoji', () => {
    expect(resolveAppearance({ color: 'green', icon: 'book' })).toEqual({
      hue: 'green',
      icon: { kind: 'glyph', name: 'book' },
    });
    expect(resolveAppearance({ icon: '🚀' })).toEqual({
      hue: null,
      icon: { kind: 'emoji', text: '🚀' },
    });
  });

  it('counts one emoji as a person sees one', () => {
    expect(isSingleEmoji('👍🏽')).toBe(true);
    expect(isSingleEmoji('👩‍💻')).toBe(true);
    expect(isSingleEmoji('🇳🇿')).toBe(true);
    expect(isSingleEmoji('🚀🚀')).toBe(false);
    expect(isSingleEmoji('a')).toBe(false);
    expect(isSingleEmoji('')).toBe(false);
  });
});
