import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileMeeting, meetingInputOf } from './meeting-note.ts';

const run = promisify(execFile);
const CLI = join(import.meta.dirname, 'meeting-note.ts');
const FIXTURE = join(import.meta.dirname, 'n8n', 'fixtures', 'gemini-larkspur-sync.json');
const PATH = 'Meetings/2026/11/2026-11-21 Weekly sync.md';
const input = { title: 'Weekly sync', date: '2026-11-21', attendees: [{ name: 'Mara Quill' }] };

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'lite-meeting-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe('fileMeeting', () => {
  it('writes a new note at its path, then adds a transcript to it without touching the rest', async () => {
    expect(await fileMeeting(vault, meetingInputOf(input, false))).toEqual({
      path: PATH,
      written: true,
    });
    const file = join(vault, ...PATH.split('/'));
    await writeFile(file, `${await readFile(file, 'utf8')}\nMy own line.\n`);
    const later = { ...input, transcript: [{ speaker: 'Mara Quill', text: 'Hello.' }] };
    await fileMeeting(vault, meetingInputOf(later, false));
    const text = await readFile(file, 'utf8');
    expect(text).toContain('\nMy own line.\n\n## Transcript\n\n**Mara Quill** Hello.\n');
    expect(await fileMeeting(vault, meetingInputOf(later, false))).toEqual({
      path: PATH,
      written: false,
    });
  });
});

describe('node tools/meeting-note.ts', () => {
  it('files a Gemini meeting from a file and prints the path', async () => {
    const { stdout } = await run(process.execPath, [CLI, vault, FIXTURE, '--gemini']);
    expect(stdout).toBe('Meetings/2026/11/2026-11-20 Larkspur rollout sync.md\n');
    const text = await readFile(join(vault, ...stdout.trim().split('/')), 'utf8');
    expect(text).toContain('- With: [[Mara Quill]], [[Tobias Fenn]]\n');
  });

  it('refuses bad input with exit 1 and writes nothing', async () => {
    const bad = join(vault, 'bad.json');
    await writeFile(bad, JSON.stringify({ title: 'x' }));
    const failed = await run(process.execPath, [CLI, vault, bad]).catch((error: unknown) => error);
    expect(failed).toMatchObject({ code: 1, stderr: expect.stringContaining('date: missing') });
  });

  it('prints its usage with exit 2 when the vault is not given', async () => {
    const failed = await run(process.execPath, [CLI]).catch((error: unknown) => error);
    expect(failed).toMatchObject({ code: 2, stderr: expect.stringContaining('Usage:') });
  });
});
