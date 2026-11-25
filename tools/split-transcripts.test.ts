import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { splitReport, splitTranscripts } from './split-transcripts.ts';

const run = promisify(execFile);
const CLI = join(import.meta.dirname, 'split-transcripts.ts');
const MEETING = 'Meetings/2026/11/2026-11-17 Larkspur Payroll renewal.md';
const TRANSCRIPT = 'Transcripts/2026/11/2026-11-17 Larkspur Payroll renewal (transcript).md';
const TURNS =
  '**Mara Quill** [00:00:04] Can we keep the rate?\n\n**Tobias Fenn** For two years, yes.  ';
const NOTE = `Renewal call. #meeting\n\n- When: 2026-11-17 09:30\n\n## Notes\n\nFlat rate.\n\n## Transcript\n\n${TURNS}\n`;

let vault: string;
const at = (path: string) => join(vault, ...path.split('/'));
const read = (path: string) => readFile(at(path), 'utf8').catch(() => null);
async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(at(path)), { recursive: true });
  await writeFile(at(path), text);
}

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'lite-split-'));
  await put(MEETING, NOTE);
  await put('Meetings/2026/11/2026-11-18 Weekly sync.md', 'Sync. #meeting\n\n## Notes\n\nNone.\n');
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe('split-transcripts', () => {
  it('changes nothing on a dry run, and says what it would move', async () => {
    const report = await splitTranscripts(vault, false);
    expect(await read(MEETING)).toBe(NOTE);
    expect(await read(TRANSCRIPT)).toBeNull();
    expect(splitReport(report)).toContain(`- ${MEETING} → ${TRANSCRIPT} (3 lines)`);
    expect(splitReport(report)).toContain('Run again with `--write`');
  });

  it('with --write, moves every byte of the transcript and links it; a second run does nothing', async () => {
    await splitTranscripts(vault, true);
    expect(await read(TRANSCRIPT)).toBe(
      `Transcript of the meeting [[2026-11-17 Larkspur Payroll renewal]].\n\n${TURNS}\n`,
    );
    const meeting = await read(MEETING);
    expect(meeting).toBe(
      'Renewal call. #meeting\n\n- When: 2026-11-17 09:30\n- Transcript: [[2026-11-17 Larkspur Payroll renewal (transcript)]]\n\n## Notes\n\nFlat rate.\n',
    );
    const again = await splitTranscripts(vault, true);
    expect(again.outcomes).toEqual([]);
    expect(await read(MEETING)).toBe(meeting);
  });

  it('leaves a note whose transcript path holds a different note, and says why', async () => {
    await put(TRANSCRIPT, 'Someone else’s note.\n');
    const report = await splitTranscripts(vault, true);
    expect(await read(MEETING)).toBe(NOTE);
    expect(await read(TRANSCRIPT)).toBe('Someone else’s note.\n');
    expect(splitReport(report)).toContain(`- ${MEETING}: another note is at ${TRANSCRIPT}`);
  });

  it('finishes a split an earlier run left halfway: the transcript note there is this one', async () => {
    await splitTranscripts(vault, true);
    await put(MEETING, NOTE);
    await splitTranscripts(vault, true);
    expect(await read(MEETING)).not.toContain('## Transcript');
  });

  it('names the notes that link a block of a moved transcript', async () => {
    await put(MEETING, NOTE.replace('yes.  ', 'yes. ^t0002'));
    await put('Projects/Larkspur.md', 'Quote: [[2026-11-17 Larkspur Payroll renewal#^t0002]]\n');
    const report = splitReport(await splitTranscripts(vault, false));
    expect(report).toContain('## Links to a block of a moved transcript');
    expect(report).toContain(`- ${MEETING} → ${TRANSCRIPT}: Projects/Larkspur.md`);
  });

  it('leaves a note it cannot split safely as it is, and says why', async () => {
    const withHeading = NOTE.replace('yes.  ', 'yes.\n\n## Follow-up (mine)');
    await put(MEETING, withHeading.replace('## Follow-up', '```\n## Follow-up'));
    const report = splitReport(await splitTranscripts(vault, true));
    expect(await read(MEETING)).toContain('## Follow-up');
    expect(await read(TRANSCRIPT)).toBeNull();
    expect(report).toContain('## Left as they are');
    expect(report).toContain(`- ${MEETING}: `);
  });

  it('lists a note that links a transcript note and still holds one inline', async () => {
    const both = NOTE.replace(
      '- When: 2026-11-17 09:30\n',
      '- When: 2026-11-17 09:30\n- Transcript: [[2026-11-17 Larkspur Payroll renewal (transcript)]]\n',
    );
    await put(MEETING, both);
    const report = splitReport(await splitTranscripts(vault, false));
    expect(report).toMatch(new RegExp(`- ${MEETING}: .*already links`));
    expect(report).toContain('Would move 0');
  });

  it('says on a dry run that two meeting notes with one name would clash', async () => {
    const twin = 'Meetings/Archive/2026-11-17 Larkspur Payroll renewal.md';
    await put(twin, NOTE);
    const report = splitReport(await splitTranscripts(vault, false));
    expect(report).toContain('Would move 1');
    expect(report).toMatch(new RegExp(`- ${twin}: .*same name`));
  });

  it('never splits a conflict copy, and lists it', async () => {
    const copy = 'Meetings/2026/11/2026-11-17 Larkspur Payroll renewal (conflict from Studio).md';
    await put(copy, NOTE);
    const report = splitReport(await splitTranscripts(vault, true));
    expect(await read(copy)).toBe(NOTE);
    expect(report).toMatch(new RegExp(`- ${copy.replace(/[()]/g, '\\$&')}: .*conflict copy`));
    expect(report).toContain('Moved 1');
  });

  it('tells the person to quit the app while it writes', async () => {
    expect(splitReport(await splitTranscripts(vault, false))).toContain('Quit DFAI Lite');
  });

  it('runs from the command line, dry by default, writing its report where asked', async () => {
    const reportFile = join(vault, '..', `${vault.split('/').at(-1)}-report.md`);
    const { stdout } = await run(process.execPath, [CLI, vault, '--report', reportFile]);
    expect(stdout).toContain('dry run: nothing changed');
    expect(await readFile(reportFile, 'utf8')).toContain('Would move 1');
    await rm(reportFile);
    expect(await read(MEETING)).toBe(NOTE);
  });
});
