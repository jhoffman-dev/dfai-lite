import {
  MAP_END,
  MAP_LIMITS,
  MAP_START,
  README_LINE_BUDGET,
  SEARCH_SCRIPT_PATH,
  vaultReadme,
  type ReadmeUpdate,
} from './index.ts';

const NOTES = [
  { path: 'People/Mara Quill.md', text: 'Mara leads payroll at Larkspur Payroll. #person\n' },
  { path: 'People/Tobias Fenn.md', text: 'Tobias runs the ledger. #person #larkspur\n' },
  { path: 'Projects/Larkspur rollout.md', text: 'The ledger move. #project/larkspur #larkspur\n' },
  { path: 'Meetings/2026/11/2026-11-20 Weekly sync.md', text: 'Cutover agreed. #meeting\n' },
  { path: 'Meetings/2026/10/2026-10-02 Kickoff.md', text: 'Kickoff. #meeting\n' },
  { path: 'Transcripts/2026/11/2026-11-21 Weekly sync (transcript).md', text: 'Verbatim.\n' },
  { path: 'Clients/Larkspur/Notes.md', text: 'Contacts.\n' },
  { path: 'Loose idea.md', text: 'An idea.\n' },
  { path: 'README.md', text: '# Old readme\n' },
  { path: '_index/README.md', text: 'generated\n' },
];

const written = (update: ReadmeUpdate): string => {
  if (update.kind !== 'write') throw new Error(update.reason);
  return update.text;
};

const generated = (text: string): string =>
  text.slice(text.indexOf(MAP_START), text.indexOf(MAP_END) + MAP_END.length);

describe('the README map', () => {
  const map = generated(written(vaultReadme(null, NOTES)));

  it('counts notes per top-level folder, leaving out guides and generated files', () => {
    expect(map).toContain('\n8 notes.');
    expect(map).toContain('| People/ | 2 | One note per person |');
    expect(map).toContain('| Meetings/ | 2 | One note per meeting, by year and month |');
    expect(map).toContain('| Clients/ | 1 | Sub-folders: Larkspur |');
    expect(map).toContain('| (vault root) | 1 | Notes not in a folder |');
    expect(map).not.toContain('Old readme');
  });

  it('names the busiest sub-folders, the most used tags in code spans, and the newest dated notes', () => {
    expect(map).toContain('- `Meetings/2026/10/`: 1\n- `Meetings/2026/11/`: 1');
    expect(map).toContain('`#larkspur` 2, `#meeting` 2, `#person` 2, `#project/larkspur` 1');
    const dated = map.slice(map.indexOf('### Latest dated notes'));
    expect(dated.indexOf('2026-11-20 Weekly sync')).toBeLessThan(
      dated.indexOf('2026-10-02 Kickoff'),
    );
    expect(dated).not.toContain('(transcript)');
  });

  it('tells the reader how to search', () => {
    expect(map).toContain(`node ${SEARCH_SCRIPT_PATH} "rollout plan"`);
    expect(map).toContain('--transcripts');
  });

  it('gives the same bytes whatever order the notes come in', () => {
    expect(vaultReadme(null, [...NOTES].reverse())).toEqual(vaultReadme(null, NOTES));
  });

  it('stays under its line budget on a large vault', () => {
    const big = Array.from({ length: 2000 }, (_, at) => ({
      path: `Folder ${at % 40}/Sub ${at % 13}/2026-${String((at % 12) + 1).padStart(2, '0')}-01 Note ${at}.md`,
      text: `Note ${at}. #tag-${at % 200} #area/topic-${at % 30}\n`,
    }));
    const hand = 'Hand-written line.\n'.repeat(40);
    const text = written(vaultReadme(hand, big));
    expect(text.split('\n').length).toBeLessThan(README_LINE_BUDGET);
    expect(generated(text)).toContain('20 more folders');
    expect(generated(text).match(/^- `.*\.md`$/gm)).toHaveLength(MAP_LIMITS.dated);
  });
});

describe('writing the map into a README', () => {
  it('starts a missing README with a part to fill in, above the map', () => {
    const text = written(vaultReadme(null, NOTES));
    expect(text.startsWith('# About this vault\n')).toBe(true);
    expect(text.endsWith(`${MAP_END}\n`)).toBe(true);
  });

  it('appends the map to a README without markers, its text kept byte for byte', () => {
    const own = '# My vault\r\n\r\nProjects: #larkspur work.  ';
    const text = written(vaultReadme(own, NOTES));
    expect(text.startsWith(`${own}\n\n${MAP_START}`)).toBe(true);
  });

  it('replaces only what is between the markers, and changes nothing the second time', () => {
    const own = `# Mine\n\nAbove.\n${MAP_START}\nold map\n${MAP_END}\nBelow, mine too.\n`;
    const text = written(vaultReadme(own, NOTES));
    expect(text.startsWith('# Mine\n\nAbove.\n')).toBe(true);
    expect(text.endsWith(`${MAP_END}\nBelow, mine too.\n`)).toBe(true);
    expect(text).not.toContain('old map');
    expect(written(vaultReadme(text, NOTES))).toBe(text);
  });

  it('keeps a CRLF README’s own bytes exactly, with no stray line under the map', () => {
    const above = '# Mine\r\n\r\nAbove.\r\n';
    const below = 'Below, mine too.\r\n';
    const own = `${above}${MAP_START}\r\nold map\r\n${MAP_END}\r\n${below}`;
    const text = written(vaultReadme(own, NOTES));
    expect(text.startsWith(above)).toBe(true);
    expect(text.endsWith(`${MAP_END}\n${below}`)).toBe(true);
    expect(written(vaultReadme(text, NOTES))).toBe(text);
  });

  it('refuses markers it cannot trust, rather than guess', () => {
    for (const broken of [
      `${MAP_START}\nno end\n`,
      `${MAP_END}\n${MAP_START}\n`,
      `${MAP_START}\n${MAP_END}\n${MAP_START}\n${MAP_END}\n`,
    ]) {
      expect(vaultReadme(broken, NOTES).kind).toBe('refused');
    }
  });
});
