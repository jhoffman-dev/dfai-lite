// The whole preparation on real temp folders: what comes across, in what
// shape and where, and that the source is never touched.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  PREPARED_REPORT_PATH,
  PreparationRefused,
  prepareLiteVault,
} from './prepare-lite-vault.ts';
import { listFiles } from './vault-files.ts';

const MEETING = (provider: string, id: string, start: string) => `---
type: meeting
atlas_import: meeting/v1
title: 'Weekly sync'
date: '2026-11-24'
start: '${start}'
provider: '${provider}'
external_id: '${id}'
source_url: 'https://notes.example.test/${id}'
attendees:
  - name: 'Mara Quill'
  - name: 'Tobias Fenn'
people:
  - "[[Mara Quill]]"
  - "[[Tobias Fenn]]"
companies:
  - "[[Companies/Acme]]"
project: "[[Projects/Rollout]]"
tasks:
  - "[[Tasks/2026/11/Send plan]]"
tags: [sync]
---

<!-- atlas:summary v1 -->

> [!summary] Summary by Claude
> The team agreed to ship the cache. Then lunch.

<!-- atlas:summary v1 -->

## Transcript

**Mara Quill** Morning.
`;

const FIXTURE: Record<string, string> = {
  'Meetings/2026/11/2026-11-24 Weekly sync.md': MEETING('gemini', 'g1', '10:00'),
  'Meetings/2026/11/2026-11-24 Weekly sync (granola 68b8456f).md': MEETING(
    'granola',
    'n1',
    '10:05',
  ),
  'People/Mara Quill.md':
    "---\ntype: person\nemail: mara@example.test\nsource: notion\nnotion_id: '1'\n---\n",
  'Mara Quill.md':
    "---\ntype: person\nemail: 'mara.quill@example.test'\nrole: 'Payroll lead'\n---\n\nRuns payroll at [[Companies/Acme]].\n",
  'Companies/Acme.md': '---\ntype: company\n---\nA customer. Works with [[Mara Quill]].\n',
  'Terms/Acme.md': '---\ntype: term\nvariants: [ACME]\n---\nThe acronym.\n',
  'Projects/Rollout.md':
    '---\ntype: project\nstatus: active\npara: projects\nproject_tasks:\n  - "[[Tasks/2026/11/Send plan]]"\n---\nMoving to [[Companies/Acme]]. See ![chart](../attachments/q3.png)\n',
  'Notes/Idea.md':
    '---\ntype: notes\nfavorite: true\ntags: [idea]\n---\nAn idea about [[Terms/Acme]].\n\n![q3](../attachments/q3.png)\n',
  'Ship small.md':
    "---\ntype: decision\nsource: '[[2026-11-24 Weekly sync]]'\n---\nWe ship small.\n",
  'Tasks/2026/11/Send plan.md': '---\ntype: task\nstatus: inbox\n---\nSend it.\n',
  'Inbox/Stray task.md': '---\ntype: task\n---\nA task outside the task folder.\n',
  'Inbox/Proposals/Review what Weekly sync left for you.md': '---\ntype: proposal\n---\nReview.\n',
  'Archive/Inbox/Proposals/Old.md': '---\ntype: proposal\n---\nOld.\n',
  '.atlas/automations/log/After a meeting.md': 'log\n',
  '.atlas/templates/Task.md': '---\ntype: task\n---\n',
  '.atlas/templates/Person.md': '---\ntype: person\n---\n',
  'Sync conflicts/atlas/types': 'x',
  '.atlas-cache/index.sqlite': 'cache',
  '.gitignore': '.atlas-cache/\n',
  'attachments/q3.png': 'PNG',
};

let root: string;
let source: string;
let output: string;

async function put(base: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(base, path)), { recursive: true });
  await writeFile(join(base, path), text);
}

const read = (path: string): Promise<string> => readFile(join(output, path), 'utf8');
const paths = async (folder: string): Promise<string[]> =>
  (await listFiles(folder, new Set())).map(({ path }) => path);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lite-prepare-'));
  source = join(root, 'dfai');
  output = join(root, 'lite');
  for (const [path, text] of Object.entries(FIXTURE)) await put(source, path, text);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('prepareLiteVault', () => {
  it('leaves the source exactly as it was', async () => {
    const before = await Promise.all(
      (await paths(source)).map((path) => readFile(join(source, path), 'utf8')),
    );
    await prepareLiteVault(source, output);
    const after = await Promise.all(
      (await paths(source)).map((path) => readFile(join(source, path), 'utf8')),
    );
    expect(after).toEqual(before);
  });

  it('leaves out tasks, proposals, automations and DFAI state, and reports each', async () => {
    const report = await prepareLiteVault(source, output);
    const written = await paths(output);
    expect(
      written.some((path) =>
        /Tasks|Proposals|Stray task|\.atlas|Sync conflicts|Task\.md/.test(path),
      ),
    ).toBe(false);
    expect(report.leftOut.map(({ path }) => path).sort()).toEqual(
      [
        '.atlas/automations/log/After a meeting.md',
        '.atlas/templates/Task.md',
        '.gitignore',
        'Archive/Inbox/Proposals/Old.md',
        'Inbox/Proposals/Review what Weekly sync left for you.md',
        'Inbox/Stray task.md',
        'Sync conflicts/atlas/types',
        'Tasks/2026/11/Send plan.md',
      ].sort(),
    );
    expect(written).toContain('Templates/Person.md');
  });

  it('keeps both recordings of a meeting, each without frontmatter, opening with its summary', async () => {
    await prepareLiteVault(source, output);
    const gemini = await read('Meetings/2026/11/2026-11-24 Weekly sync.md');
    const granola = await read('Meetings/2026/11/2026-11-24 Weekly sync (granola 68b8456f).md');
    expect(granola.split('\n').slice(0, 8)).toEqual([
      'The team agreed to ship the cache. #sync #meeting',
      '',
      '- When: 2026-11-24 10:05',
      '- With: [[Mara Quill]], [[Tobias Fenn]]',
      '- About: [[Projects/Rollout]]',
      '- Source: https://notes.example.test/n1',
      '- Companies: [[Resources/Companies/Acme]]',
      '',
    ]);
    for (const text of [gemini, granola]) {
      expect(text.startsWith('---')).toBe(false);
      expect(text).not.toMatch(/atlas:|Tasks\/|- People:|- Tasks:/);
      expect(text).toContain('**Mara Quill** Morning.');
    }
  });

  it('merges a person kept twice into People/, keeping both emails', async () => {
    const report = await prepareLiteVault(source, output);
    expect(report.merged).toEqual(['Mara Quill.md']);
    expect((await paths(output)).filter((path) => path.includes('Mara Quill'))).toEqual([
      'People/Mara Quill.md',
    ]);
    const person = await read('People/Mara Quill.md');
    expect(person).toContain('Runs payroll at [[Resources/Companies/Acme]].');
    expect(person).toContain('- Email: mara.quill@example.test');
    expect(person).toContain('## Also recorded as\n\n- Email: mara@example.test');
    expect(person).not.toMatch(/notion/i);
  });

  it('moves folders into the layout with links, images and favorites re-pointed', async () => {
    await prepareLiteVault(source, output);
    expect(await read('Resources/Companies/Acme.md')).toBe(
      'A customer. Works with [[Mara Quill]].\n',
    );
    expect(await read('Resources/Glossary/Acme.md')).toContain('- Variants: ACME');
    expect(await read('Resources/Notes/Idea.md')).toBe(
      'An idea about [[Resources/Glossary/Acme]].\n\n#idea\n\n![q3](../../attachments/q3.png)\n',
    );
    expect(await read('Projects/Rollout.md')).toBe(
      'Moving to [[Resources/Companies/Acme]]. See ![chart](../attachments/q3.png)\n\n- Status: active\n',
    );
    expect(await read('Resources/Decisions/Ship small.md')).toBe(
      'We ship small.\n\n- Source: [[2026-11-24 Weekly sync]]\n',
    );
    expect(JSON.parse(await read('.dfai-lite/favorites.json'))).toEqual([
      'Resources/Notes/Idea.md',
    ]);
  });

  it('writes the vault files: instructions, index, gitignore, kept folders and the report in Archive', async () => {
    await prepareLiteVault(source, output);
    const written = await paths(output);
    for (const path of [
      'CLAUDE.md',
      '_index/README.md',
      'Inbox/.gitkeep',
      'skills/.gitkeep',
      PREPARED_REPORT_PATH,
    ]) {
      expect(written).toContain(path);
    }
    expect(written).not.toContain('MIGRATION-REPORT.md');
    expect(await read('.gitignore')).toBe('.DS_Store\n');
    expect(await read(PREPARED_REPORT_PATH)).toContain('## Prepared for DFAI Lite');
  });

  it('refuses an output folder that already holds something', async () => {
    await put(output, 'keep.md', 'mine');
    await expect(prepareLiteVault(source, output)).rejects.toBeInstanceOf(PreparationRefused);
    expect(await read('keep.md')).toBe('mine');
  });
});
