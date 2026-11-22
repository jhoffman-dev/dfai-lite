import { rankTagSuggestions, tagHue, type TagCount } from './index.ts';

const COUNTS: readonly TagCount[] = [
  { key: 'project', name: 'project', count: 4 },
  { key: 'project/active', name: 'project/active', count: 7 },
  { key: 'para/resource', name: 'para/resource', count: 2 },
  { key: 'person', name: 'Person', count: 9 },
  { key: 'reading', name: 'reading', count: 1 },
];

describe('the tags offered after `#`', () => {
  it('offers nothing until a letter is typed, so `# ` stays a heading and `#1` a number', () => {
    expect(rankTagSuggestions('', COUNTS)).toEqual([]);
    expect(rankTagSuggestions('1', COUNTS)).toEqual([]);
  });

  it('puts the tag typed first, then those it starts, most used first', () => {
    expect(rankTagSuggestions('pro', COUNTS).map((tag) => tag.name)).toEqual([
      'pro',
      'project/active',
      'project',
    ]);
    expect(rankTagSuggestions('project', COUNTS)[0]).toEqual({
      kind: 'existing',
      name: 'project',
      count: 4,
    });
  });

  it('offers to create the tag typed when none has its name, and finds nested parts', () => {
    expect(rankTagSuggestions('res', COUNTS)).toEqual([
      { kind: 'create', name: 'res' },
      { kind: 'existing', name: 'para/resource', count: 2 },
    ]);
  });

  it('matches without regard to case, offering the tag as first written', () => {
    expect(rankTagSuggestions('PERSON', COUNTS)[0]).toEqual({
      kind: 'existing',
      name: 'Person',
      count: 9,
    });
  });

  it('never offers to create what would not read back as that one tag', () => {
    expect(rankTagSuggestions('a#b', [])).toEqual([]);
  });
});

describe('a tag’s hue', () => {
  it('is the same for the same tag, whatever its case, `#` or spaces', () => {
    expect(tagHue('#Project/Active ')).toBe(tagHue('project/active'));
  });

  it('spreads tags over the pastels, never gray', () => {
    const hues = new Set(Array.from({ length: 200 }, (_, at) => tagHue(`tag${String(at)}`)));
    expect(hues.size).toBe(8);
    expect(hues.has('gray' as never)).toBe(false);
  });

  it('is pinned, to DFAI’s own: changing the hash would recolor every vault', () => {
    expect(['idea', 'project', 'person', 'meeting'].map(tagHue)).toEqual([
      'red',
      'blue',
      'pink',
      'purple',
    ]);
  });
});
