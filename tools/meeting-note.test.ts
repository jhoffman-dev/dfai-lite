import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MEETING_QUEUE_PATH, queuedMeetings } from '../src/domain/meetings/index.ts';
import { fileMeeting, meetingInputOf } from './meeting-note.ts';

const run = promisify(execFile);
const CLI = join(import.meta.dirname, 'meeting-note.ts');
const FIXTURE = join(import.meta.dirname, 'n8n', 'fixtures', 'gemini-larkspur-sync.json');
const PATH = 'Meetings/2026/11/2026-11-21 Weekly sync.md';
const TODAY = '2026-11-24';
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
    expect(await fileMeeting(vault, meetingInputOf(input, false), TODAY)).toEqual({
      path: PATH,
      written: true,
      queued: true,
    });
    const file = join(vault, ...PATH.split('/'));
    await writeFile(file, `${await readFile(file, 'utf8')}\nMy own line.\n`);
    const later = { ...input, transcript: [{ speaker: 'Mara Quill', text: 'Hello.' }] };
    expect(await fileMeeting(vault, meetingInputOf(later, false), TODAY)).toMatchObject({
      queued: false,
    });
    const text = await readFile(file, 'utf8');
    expect(text).toContain('\nMy own line.\n\n## Transcript\n\n**Mara Quill** Hello.\n');
    expect(await fileMeeting(vault, meetingInputOf(later, false), TODAY)).toEqual({
      path: PATH,
      written: false,
      queued: false,
    });
    const queue = await readFile(join(vault, ...MEETING_QUEUE_PATH.split('/')), 'utf8');
    expect(queuedMeetings(queue)).toEqual([PATH]);
    expect(queue).toContain(`added ${TODAY}\n`);
  });

  it('adds to a queue that is there, and leaves it alone for a note that was there', async () => {
    const queueFile = join(vault, ...MEETING_QUEUE_PATH.split('/'));
    await fileMeeting(vault, meetingInputOf({ ...input, title: 'Retro' }, false), TODAY);
    await writeFile(queueFile, `${await readFile(queueFile, 'utf8')}Kept.\n`);
    await fileMeeting(vault, meetingInputOf(input, false), TODAY);
    const queue = await readFile(queueFile, 'utf8');
    expect(queue).toContain('Kept.\n- [[Meetings/2026/11/2026-11-21 Weekly sync]]');
    expect(queuedMeetings(queue)).toHaveLength(2);
  });
});

describe('fileMeeting and the queue', () => {
  const queueFile = () => join(vault, ...MEETING_QUEUE_PATH.split('/'));

  it('queues on a rerun a note whose line an earlier run could not write', async () => {
    await fileMeeting(vault, meetingInputOf(input, false), TODAY);
    await unlink(queueFile());
    expect(await fileMeeting(vault, meetingInputOf(input, false), TODAY)).toEqual({
      path: PATH,
      written: false,
      queued: true,
    });
    expect(queuedMeetings(await readFile(queueFile(), 'utf8'))).toEqual([PATH]);
  });

  it('does not queue a note that already has Claude’s summary', async () => {
    await fileMeeting(vault, meetingInputOf(input, false), TODAY);
    await unlink(queueFile());
    const file = join(vault, ...PATH.split('/'));
    const text = await readFile(file, 'utf8');
    await writeFile(file, `${text}\n<!-- dfai-lite:summary v1 -->\n`);
    expect((await fileMeeting(vault, meetingInputOf(input, false), TODAY)).queued).toBe(false);
    await expect(readFile(queueFile(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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
