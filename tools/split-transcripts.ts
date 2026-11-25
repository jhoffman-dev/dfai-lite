// Moves the transcripts written inline in meeting notes (`## Transcript`) into
// transcript notes of their own, once:
//   node tools/split-transcripts.ts <vault dir> [--write] [--report <file>]
// A dry run by default: it changes nothing and says what it would do. With
// `--write` it creates each transcript note (never over another note), then
// takes the section out of the meeting note and links the transcript in its
// header. Every run writes a report. Running it again does nothing more.
import { stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noteTitle } from '../src/domain/vault/index.ts';
import {
  hasInlineTranscript,
  isMeetingNotePath,
  splitInlineTranscript,
  type SplitTranscript,
} from '../src/domain/meetings/index.ts';
import { changeFile, readMarkdown, readVaultFile } from './vault-files.ts';

/** What became of one meeting note with a transcript inline. */
export interface SplitOutcome {
  readonly meeting: string;
  readonly transcript: string;
  /** How many lines of transcript moved, or would move. */
  readonly lines: number;
  /** Null when it was split (or would be); else why it was left as it is. */
  readonly skipped: string | null;
  /**
   * Notes linking a block of the moved transcript (`[[Meeting#^t0001]]`):
   * after the split that block is in the transcript note, so each such link
   * is for the person to point at it.
   */
  readonly blockLinks: readonly string[];
}

export interface SplitRun {
  readonly write: boolean;
  /** Meeting notes read. */
  readonly meetings: number;
  readonly outcomes: readonly SplitOutcome[];
}

/**
 * Why a split cannot go ahead safely, or null: the moved text must be in the
 * original note and, whole, in the transcript note, and no inline transcript
 * may be left behind. A byte that would be lost stops the note.
 */
function unsafe(original: string, split: SplitTranscript): string | null {
  if (!original.includes(split.moved)) return 'the moved text is not the note’s own';
  if (!split.transcript.text.includes(split.moved)) return 'the transcript note would not hold it';
  if (hasInlineTranscript(split.meeting)) return 'a second ## Transcript section would stay';
  return null;
}

/** Why the transcript note's path is taken by a different note, or null when it is free or already this one. */
async function pathTaken(vault: string, split: SplitTranscript): Promise<string | null> {
  const there = await readVaultFile(vault, split.transcript.path);
  return there === null || there === split.transcript.text
    ? null
    : `another note is at ${split.transcript.path}`;
}

/** Creates the transcript note, then rewrites the meeting note, unless it changed since it was read. */
async function applySplit(vault: string, path: string, split: SplitTranscript): Promise<void> {
  await changeFile(vault, split.transcript.path, (there) => there ?? split.transcript.text);
  if ((await readVaultFile(vault, split.transcript.path)) !== split.transcript.text) {
    throw new Error(`another note reached ${split.transcript.path} first`);
  }
  await changeFile(vault, path, (now) => {
    const again = now === null ? null : splitInlineTranscript(path, now);
    if (again === null || again.transcript.text !== split.transcript.text) {
      throw new Error('it changed while this ran');
    }
    return again.meeting;
  });
}

interface Note {
  readonly path: string;
  readonly text: string;
}

/** The notes with a link to a block in the meeting's moved transcript, by name or by path. */
function blockLinksInto(meeting: Note, moved: string, notes: readonly Note[]): string[] {
  if (!/\^[\w-]+\s*$/m.test(moved)) return [];
  const targets = [noteTitle(meeting.path), meeting.path.replace(/\.md$/i, '')].map(
    (target) => `[[${target.toLowerCase()}#^`,
  );
  return notes
    .filter(({ text }) => targets.some((target) => text.toLowerCase().includes(target)))
    .map(({ path }) => path);
}

async function splitOne(
  vault: string,
  { note, notes }: { note: Note; notes: readonly Note[] },
  write: boolean,
): Promise<SplitOutcome | null> {
  const split = splitInlineTranscript(note.path, note.text);
  if (split === null) return null;
  const base = {
    meeting: note.path,
    transcript: split.transcript.path,
    lines: split.moved.split('\n').length,
    blockLinks: blockLinksInto(note, split.moved, notes),
  };
  const problem = unsafe(note.text, split) ?? (await pathTaken(vault, split));
  if (problem !== null || !write) return { ...base, skipped: problem };
  try {
    await applySplit(vault, note.path, split);
  } catch (error) {
    // One note's failure is reported and the run goes on; nothing of it was lost.
    return { ...base, skipped: error instanceof Error ? error.message : String(error) };
  }
  return { ...base, skipped: null };
}

/** Finds every meeting note under `Meetings/` with an inline transcript and splits it (`write`) or says it would. */
export async function splitTranscripts(vault: string, write: boolean): Promise<SplitRun> {
  const notes = await readMarkdown(vault);
  const meetings = notes.filter(({ path }) => isMeetingNotePath(path));
  const outcomes: SplitOutcome[] = [];
  for (const note of meetings) {
    const outcome = await splitOne(vault, { note, notes }, write);
    if (outcome !== null) outcomes.push(outcome);
  }
  return { write, meetings: meetings.length, outcomes };
}

/** The report, as markdown a person reads. */
export function splitReport(run: SplitRun): string {
  const done = run.outcomes.filter(({ skipped }) => skipped === null);
  const left = run.outcomes.filter(({ skipped }) => skipped !== null);
  const linked = done.filter(({ blockLinks }) => blockLinks.length > 0);
  const verb = run.write ? 'Moved' : 'Would move';
  return [
    `# Transcripts split out of meeting notes${run.write ? '' : ' (dry run: nothing changed)'}`,
    '',
    `${run.meetings} meeting notes read; ${run.outcomes.length} hold a transcript inline.`,
    `${verb} ${done.length}; left ${left.length} as they are.`,
    ...(run.write || done.length === 0 ? [] : ['', 'Run again with `--write` to move them.']),
    ...(done.length === 0 ? [] : ['', `## ${verb}`, '']),
    ...done.map((each) => `- ${each.meeting} → ${each.transcript} (${each.lines} lines)`),
    ...(left.length === 0 ? [] : ['', '## Left as they are', '']),
    ...left.map((each) => `- ${each.meeting}: ${each.skipped ?? ''}`),
    ...(linked.length === 0
      ? []
      : [
          '',
          '## Links to a block of a moved transcript',
          '',
          'Point these at the transcript note:',
          '',
        ]),
    ...linked.map(
      (each) => `- ${each.meeting} → ${each.transcript}: ${each.blockLinks.join(', ')}`,
    ),
    '',
  ].join('\n');
}

const USAGE = 'Usage: node tools/split-transcripts.ts <vault dir> [--write] [--report <file>]';

/** The arguments, or null when they are not the usage. */
function parseArgs(
  args: readonly string[],
): { vault: string; write: boolean; report: string } | null {
  const rest = [...args];
  const write = rest.includes('--write');
  const at = rest.indexOf('--report');
  const report = at === -1 ? join(tmpdir(), 'split-transcripts-report.md') : rest[at + 1];
  const positional = rest.filter(
    (arg, index) => arg !== '--write' && index !== at && (at === -1 || index !== at + 1),
  );
  if (positional.length !== 1 || report === undefined) return null;
  return { vault: positional[0] as string, write, report };
}

async function main(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed === null) {
    console.error(USAGE);
    return 2;
  }
  const folder = await stat(parsed.vault).catch(() => null);
  if (folder === null || !folder.isDirectory()) {
    console.error(`Not a folder: ${parsed.vault}`);
    return 2;
  }
  const run = await splitTranscripts(parsed.vault, parsed.write);
  const report = splitReport(run);
  await writeFile(parsed.report, report, 'utf8');
  console.log(report);
  console.log(`Report: ${resolve(parsed.report)}`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
