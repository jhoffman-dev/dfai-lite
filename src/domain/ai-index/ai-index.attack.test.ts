// Attacks on the AI index: every visible note listed exactly once, no two
// generated files at one path, and the same bytes whatever the input order.
import { buildAiIndex, type IndexFile } from './index.ts';

/** A seeded generator (mulberry32), so a failure replays exactly. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let at = copy.length - 1; at > 0; at -= 1) {
    const other = Math.floor(random() * (at + 1));
    [copy[at], copy[other]] = [copy[other] as T, copy[at] as T];
  }
  return copy;
}

/** How many folder-file lines start with `path |` or are exactly `path`. */
function listings(files: readonly IndexFile[], path: string): number {
  return files
    .filter((file) => file.path.startsWith('_index/folders/'))
    .flatMap((file) => file.text.split('\n'))
    .filter((line) => line === path || line.startsWith(`${path} | `)).length;
}

describe('buildAiIndex under attack', () => {
  it('writes no two files at the same path when a top-level folder is named `_root`', () => {
    const files = buildAiIndex([
      { path: 'Welcome.md', text: 'Start here.\n' },
      { path: '_root/Larkspur Payroll.md', text: 'The payroll project.\n' },
    ]);
    const paths = files.map(({ path }) => path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(listings(files, 'Welcome.md')).toBe(1);
    expect(listings(files, '_root/Larkspur Payroll.md')).toBe(1);
  });

  it('lists every note exactly once, whatever the order the notes arrive in', () => {
    const random = seeded(20261121);
    const notes: IndexFile[] = [];
    for (let at = 0; at < 900; at += 1) {
      const folder = ['People', 'Projects', 'Archive/2024', 'Meetings/2026/09'][at % 4];
      notes.push({ path: `${folder}/Note ${at}.md`, text: `Note ${at} about [[Note ${at + 1}]].\n` });
    }
    const first = buildAiIndex(notes);
    for (let round = 0; round < 3; round += 1) {
      expect(buildAiIndex(shuffled(notes, random))).toEqual(first);
    }
    for (const { path } of notes) expect(listings(first, path)).toBe(1);
  });

  it('keeps one line per note when a first sentence holds a newline-like separator', () => {
    const files = buildAiIndex([
      { path: 'People/Mara Quill.md', text: 'Mara leads payroll\u2028at Larkspur\u0085Payroll.\n' },
    ]);
    expect(listings(files, 'People/Mara Quill.md')).toBe(1);
    const folder = files.find(({ path }) => path === '_index/folders/People.md');
    expect(folder?.text.split(/\r\n|[\r\n\u2028\u2029\u0085]/)).toHaveLength(4);
  });
});
