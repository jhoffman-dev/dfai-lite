// Property-style attack on rename/move retargeting over a seeded generator:
// every link opens after the move what it opened before (or, if it opened
// nothing, is left byte for byte), and a link's heading and alias survive.
import { foldedPath, type VaultPath } from '../vault/index.ts';
import { moveResolvers, notesAfterMove, retargetLinks, wikiLinkSpans } from './index.ts';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Mara Quill', 'mara quill', 'Tobias Fenn', 'Café', 'Café', 'Larkspur Payroll', 'Ghost'];
const FOLDERS = ['', 'People', 'Projects', 'Archive/Old', 'people'];

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

const pathOf = (folder: string, name: string): VaultPath =>
  folder === '' ? `${name}.md` : `${folder}/${name}.md`;

interface Scenario {
  readonly notes: VaultPath[];
  readonly from: VaultPath;
  readonly to: VaultPath;
  readonly text: string;
}

function scenario(random: () => number): Scenario | null {
  const notes = new Map<string, VaultPath>();
  for (let at = 0; at < 6; at += 1) {
    const path = pathOf(pick(FOLDERS, random), pick(NAMES.slice(0, -1), random));
    if (!notes.has(foldedPath(path))) notes.set(foldedPath(path), path);
  }
  const paths = [...notes.values()];
  const from = pick(paths, random);
  const to = pathOf(pick(FOLDERS, random), pick(NAMES, random));
  if (to === from || notes.has(foldedPath(to))) return null;
  const links: string[] = [];
  for (let at = 0; at < 8; at += 1) {
    const byPath = random() < 0.4;
    const target = byPath ? pick(paths, random).replace(/\.md$/, '') : pick(NAMES, random);
    const heading = random() < 0.3 ? '#Notes' : '';
    const alias = random() < 0.3 ? '|shown' : '';
    links.push(`${random() < 0.2 ? '!' : ''}[[${target}${heading}${alias}]]`);
  }
  return { notes: paths, from, to, text: `See ${links.join(' and ')}.\n` };
}

describe('retargetLinks under a seeded generator', () => {
  it('re-points every link to what it opened before the move, keeping headings and aliases', () => {
    const random = seeded(424242);
    const failures: string[] = [];
    for (let round = 0; round < 3000 && failures.length < 3; round += 1) {
      const run = scenario(random);
      if (run === null) continue;
      const across = notesAfterMove({ from: run.from, to: run.to }, run.notes);
      const resolvers = moveResolvers(across);
      const { text } = retargetLinks(run.text, resolvers);
      const before = wikiLinkSpans(run.text);
      const after = wikiLinkSpans(text);
      if (before.length !== after.length) {
        failures.push(`link count changed: ${run.text} → ${text}`);
        continue;
      }
      before.forEach((old, at) => {
        const now = after[at];
        if (now === undefined) return;
        const opened = resolvers.before(old.link.target);
        const expected = opened === null ? null : (across.moved.get(opened) ?? opened);
        const opens = resolvers.after(now.link.target);
        if (opens !== expected && !(opened === null && now.link.target === old.link.target)) {
          failures.push(
            `[[${old.link.target}]] opened ${String(opened)}, now [[${now.link.target}]] opens ${String(opens)} (move ${run.from} → ${run.to} among ${run.notes.join(', ')})`,
          );
        }
        if (now.link.heading !== old.link.heading || now.link.alias !== old.link.alias) {
          failures.push(`heading/alias changed: ${run.text} → ${text}`);
        }
      });
    }
    expect(failures).toEqual([]);
  });
});
