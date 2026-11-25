import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { SEARCH_BUNDLE_PATH, buildSearchScript } from './build-search.ts';
import { runSearch } from './search-cli.ts';

const run = promisify(execFile);
const OLD = new Date(2026, 0, 5, 12);
const RECENT = new Date(2026, 10, 20, 12);

let vault: string;

async function put(path: string, text: string, changed = RECENT): Promise<void> {
  const file = join(vault, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  await utimes(file, changed, changed);
}

/** The committed script, run as Claude runs it: copied into the vault, from another folder. */
async function search(...argv: string[]): Promise<string> {
  const { stdout } = await run(
    process.execPath,
    [join(vault, '.dfai-lite', 'search.mjs'), ...argv],
    { cwd: tmpdir() },
  );
  return stdout;
}

beforeAll(async () => {
  vault = await mkdtemp(join(tmpdir(), 'lite-search-'));
  await put(
    'Projects/Larkspur rollout.md',
    'The ledger move. #project/larkspur\n\n## Cutover\nMara Quill owns the cutover.\n',
  );
  await put('People/Mara Quill.md', 'Mara leads payroll at Larkspur Payroll. #person\n', OLD);
  await put(
    'Meetings/2026/11/2026-11-20 Weekly sync.md',
    'Cutover agreed with [[Mara Quill]]. #meeting\n',
  );
  await put(
    'Transcripts/2026/11/2026-11-20 Weekly sync (transcript).md',
    'Tobias Fenn: the cutover is on the 3rd.\n',
  );
  await put('_index/README.md', 'cutover\n');
  await put('attachments/cutover.md', 'cutover\n');
  await put('README.md', 'cutover\n');
  await mkdir(join(vault, '.dfai-lite'));
  await copyFile(SEARCH_BUNDLE_PATH, join(vault, '.dfai-lite', 'search.mjs'));
});

afterAll(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe('the vault search script', () => {
  it('is up to date with its sources (rebuild: node tools/search/build-search.ts)', async () => {
    expect(await readFile(SEARCH_BUNDLE_PATH, 'utf8')).toBe(await buildSearchScript());
  });

  it('imports nothing but Node built-ins', async () => {
    const imports = (await readFile(SEARCH_BUNDLE_PATH, 'utf8')).match(/^\s*import .*$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/from 'node:[a-z/]+';$/);
  });

  it('prints ranked blocks with matching lines, skipping generated, guide and attachment files', async () => {
    expect(await search('cutover')).toBe(
      [
        '2 notes match the query cutover:',
        'Projects/Larkspur rollout.md | #project/larkspur | changed 2026-11-20',
        '  3: ## Cutover',
        '  4: Mara Quill owns the cutover.',
        'Meetings/2026/11/2026-11-20 Weekly sync.md | #meeting | changed 2026-11-20',
        '  1: Cutover agreed with [[Mara Quill]]. #meeting',
        '',
      ].join('\n'),
    );
  });

  it('reads transcripts only when asked, and filters by date, backlinks and name', async () => {
    expect(await search('"on the 3rd"')).toMatch(/^No notes match/);
    expect(await search('"on the 3rd"', '--transcripts')).toContain(
      'Transcripts/2026/11/2026-11-20 Weekly sync (transcript).md',
    );
    expect(await search('--since', '2026-11-01', '--folder', 'People')).toMatch(
      /^No notes match the filters/,
    );
    expect(await search('--links-to', 'Mara Quill')).toBe(
      [
        '1 note matches the filters:',
        'Meetings/2026/11/2026-11-20 Weekly sync.md | #meeting | changed 2026-11-20',
        '  = Cutover agreed with Mara Quill.',
        '',
      ].join('\n'),
    );
    expect(await search('--title', 'quill')).toBe(
      '1 note matches the query quill:\nPeople/Mara Quill.md | #person | changed 2026-01-05\n',
    );
  });

  it('says how many more there are past the limit', async () => {
    expect((await search('cutover', '--limit', '1')).split('\n')[0]).toBe(
      '2 notes match the query cutover; the best 1 (--limit for more):',
    );
  });

  it('exits 2 with the usage on a bad option or a missing vault', async () => {
    const errors: string[] = [];
    const base = {
      scriptPath: '/x/search.mjs',
      cwd: vault,
      nowMs: RECENT.getTime(),
      print: () => {},
      printError: (text: string) => errors.push(text),
    };
    expect(await runSearch({ ...base, argv: ['--limit'] })).toBe(2);
    expect(await runSearch({ ...base, argv: ['x', '--vault', join(vault, 'missing')] })).toBe(2);
    expect(errors.join('')).toMatch(/--limit needs a value[\s\S]*Not a folder/);
  });
});
