// Attacks on the whole migration, on real temp folders: the source must stay
// byte-identical, and no note may vanish from the new vault unreported.
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { migrate, reportLines } from './migrate-from-dfai.ts';

let root: string;
let source: string;
let output: string;

async function put(base: string, path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(join(base, path)), { recursive: true });
  await writeFile(join(base, path), content);
}

/** Every entry under `folder` (files and links, not followed), with its bytes. */
async function tree(folder: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const walk = async (at: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(join(at, entry.name), `${path}/`);
      else if (entry.isFile())
        found.set(path, (await readFile(join(at, entry.name))).toString('hex'));
      else found.set(path, 'link');
    }
  };
  await walk(folder, '');
  return found;
}

/** Whether the report says something about `path` (a skip or a clash, with its reason). */
async function reportMentions(path: string): Promise<boolean> {
  const report = await migrate(source, output);
  return reportLines(report, output).some((line) => line.includes(path));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lite-migrate-attack-'));
  source = join(root, 'Vault');
  output = join(root, 'Lite');
  await put(source, 'Projects/Larkspur rollout.md', '---\ntype: project\n---\nThe ledger move.\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('migrate under attack', () => {
  it('never writes into the source when the output is a symlink into it', async () => {
    await mkdir(join(source, 'Scratch'));
    await symlink(join(source, 'Scratch'), join(root, 'Lite link'));
    const before = await tree(source);
    await migrate(source, join(root, 'Lite link')).catch(() => undefined);
    expect(await tree(source)).toEqual(before);
  });

  it('never writes into the source when the output differs from a folder inside it only by case', async () => {
    // macOS volumes are case-insensitive: `vault/Lite` is inside `Vault`.
    const before = await tree(source);
    await migrate(source, join(root, 'vault', 'Lite')).catch(() => undefined);
    expect(await tree(source)).toEqual(before);
  });

  it('copies a note in a nested folder named `_index`, or reports it', async () => {
    await put(source, 'Projects/_index/Plan.md', 'Mara Quill drafts the plan.\n');
    const mentioned = await reportMentions('Projects/_index/Plan.md');
    const copied = await readFile(join(output, 'Projects/_index/Plan.md'), 'utf8').catch(
      () => null,
    );
    expect(copied === 'Mara Quill drafts the plan.\n' || mentioned).toBe(true);
  });

  it('copies a note in a nested folder named `node_modules`, or reports it', async () => {
    await put(source, 'Resources/node_modules/Notes.md', 'Tobias Fenn on packaging.\n');
    const mentioned = await reportMentions('Resources/node_modules/Notes.md');
    const copied = await readFile(join(output, 'Resources/node_modules/Notes.md'), 'utf8').catch(
      () => null,
    );
    expect(copied !== null || mentioned).toBe(true);
  });

  it('reports a symlinked folder of notes rather than leaving it out silently', async () => {
    const elsewhere = join(root, 'Elsewhere');
    await put(elsewhere, 'Payroll notes.md', 'Larkspur Payroll runs on the 25th.\n');
    await symlink(elsewhere, join(source, 'Linked'));
    const mentioned = await reportMentions('Linked');
    const copied = await readFile(join(output, 'Linked/Payroll notes.md'), 'utf8').catch(
      () => null,
    );
    expect(copied !== null || mentioned).toBe(true);
  });

  it('reports a symlinked note rather than leaving it out silently', async () => {
    const elsewhere = join(root, 'Elsewhere');
    await put(elsewhere, 'Mara Quill.md', 'Leads payroll.\n');
    await mkdir(join(source, 'People'), { recursive: true });
    await symlink(join(elsewhere, 'Mara Quill.md'), join(source, 'People/Mara Quill.md'));
    expect(await reportMentions('People/Mara Quill.md')).toBe(true);
  });

  it('reports the DFAI notes it skips in `.atlas/` (dashboards, templates the user wrote)', async () => {
    await put(source, '.atlas/dashboards/Progress.md', 'Where Larkspur Payroll stands.\n');
    expect(await reportMentions('.atlas/dashboards/Progress.md')).toBe(true);
  });

  it('keeps a plain note that is not valid UTF-8 byte for byte', async () => {
    // "Café notes" saved as Latin-1 by an old editor: 0xE9 is not UTF-8.
    const bytes = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x6f, 0x74, 0x65, 0x73, 0x0a]);
    await put(source, 'Archive/Cafe.md', bytes);
    await migrate(source, output);
    expect((await readFile(join(output, 'Archive/Cafe.md'))).equals(bytes)).toBe(true);
  });

  it('keeps two meetings on the same day with the same title, and re-points a path link with heading and alias', async () => {
    const meeting = (id: string) =>
      `---\ntype: meeting\ndate: '2026-09-29'\ntitle: Weekly sync\nexternal_id: ${id}\n---\nNotes ${id}.\n`;
    await put(source, 'Inbox/Meetings/Sync a.md', meeting('a'));
    await put(source, 'Inbox/Meetings/Sync b.md', meeting('b'));
    await put(
      source,
      'Projects/Links.md',
      'See [[Inbox/Meetings/Sync b#Notes|the second]] and ![[Sync a]].\n',
    );
    const report = await migrate(source, output);
    const first = await readFile(
      join(output, 'Meetings/2026/09/2026-09-29 Weekly sync.md'),
      'utf8',
    );
    const second = await readFile(
      join(output, 'Meetings/2026/09/2026-09-29 Weekly sync 2.md'),
      'utf8',
    );
    expect(first).toContain('Notes a.');
    expect(second).toContain('Notes b.');
    expect(report.collisions).toHaveLength(1);
    expect(await readFile(join(output, 'Projects/Links.md'), 'utf8')).toBe(
      'See [[Meetings/2026/09/2026-09-29 Weekly sync 2#Notes|the second]] and ![[2026-09-29 Weekly sync]].\n',
    );
  });

  it('settles a case-only clash between a moved person and a note already in People/', async () => {
    await put(source, 'People/Mara Quill.md', 'The older page.\n');
    await put(source, 'Contacts/mara quill.md', '---\ntype: person\n---\nThe newer page.\n');
    const report = await migrate(source, output);
    expect(await readFile(join(output, 'People/Mara Quill.md'), 'utf8')).toBe('The older page.\n');
    expect(report.collisions).toEqual(['Contacts/mara quill.md → People/mara quill 2.md']);
  });
});
