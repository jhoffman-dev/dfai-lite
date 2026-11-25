// Files a meeting into a vault folder:
//   node tools/meeting-note.ts <vault dir> [input.json | -] [--gemini]
// Reads a meeting note's input as JSON (from the file, else stdin), writes the
// note at Meetings/<YYYY>/<MM>/<date> <title>.md, or adds to it when that file
// exists, and prints its path. A transcript goes to its own note under
// Transcripts/, linked from the meeting note. A note with no summary yet gets a line in the
// meetings queue, once, for Claude to summarize. `--gemini` reads the JSON as a "Notes by Gemini"
// meeting first. Plain Node, erasable TypeScript, no dependencies.
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasMeetingSummary,
  MEETING_QUEUE_PATH,
  MeetingInputError,
  fromGeminiNotes,
  meetingPath,
  meetingWrite,
  transcriptPathOf,
  parseMeetingInput,
  queueMeetings,
  wallClockIn,
  type MeetingInput,
} from '../src/domain/meetings/index.ts';
import { changeFile, readVaultFile } from './vault-files.ts';

export interface FiledMeeting {
  readonly path: string;
  /** False when the note already held everything in the input. */
  readonly written: boolean;
  /** True when this run put the note's line in the meetings queue. */
  readonly queued: boolean;
}

/** The input a JSON value describes: a meeting note's input, or a Gemini meeting with `gemini`. */
export function meetingInputOf(json: unknown, gemini: boolean): MeetingInput {
  return gemini ? fromGeminiNotes(json) : parseMeetingInput(json);
}

/**
 * Creates the transcript note the meeting note is about to link, before the
 * link: never over a transcript note already there, which is this meeting's.
 */
async function fileTranscript(vault: string, path: string, input: MeetingInput): Promise<void> {
  const transcriptExists = (await readVaultFile(vault, transcriptPathOf(path))) !== null;
  const existing = (await readVaultFile(vault, path)) ?? '';
  const { transcript } = meetingWrite(existing, input, { path, transcriptExists });
  if (transcript === null) return;
  await changeFile(vault, transcript.path, (existing) => existing ?? transcript.text);
}

/**
 * Writes the meeting's note into `vault`, merging into the note already at
 * its path, and its transcript into a transcript note. A note with no summary by Claude yet is queued for Claude, added on
 * `today` (`YYYY-MM-DD`): a rerun queues a note whose line an earlier run
 * could not write, and never queues one twice.
 */
export async function fileMeeting(
  vault: string,
  input: MeetingInput,
  today: string,
): Promise<FiledMeeting> {
  const path = meetingPath(input);
  await fileTranscript(vault, path, input);
  let note = '';
  const written = await changeFile(vault, path, (existing) => {
    note = meetingWrite(existing ?? '', input, { path }).text;
    return note;
  });
  const queued =
    !hasMeetingSummary(note) &&
    (await changeFile(vault, MEETING_QUEUE_PATH, (queue) =>
      queueMeetings(queue, [{ path, added: today }]),
    ));
  return { path, written, queued };
}

/** Today on this Mac's clock, in its own zone. */
const localToday = (): string =>
  wallClockIn(Intl.DateTimeFormat().resolvedOptions().timeZone)(Date.now()).day;

async function readInput(source: string | undefined): Promise<string> {
  if (source !== undefined && source !== '-') return readFile(source, 'utf8');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const USAGE = 'Usage: node tools/meeting-note.ts <vault dir> [input.json | -] [--gemini]';

async function main(args: readonly string[]): Promise<number> {
  const gemini = args.includes('--gemini');
  const [vault, source, ...rest] = args.filter((arg) => arg !== '--gemini');
  if (vault === undefined || rest.length > 0) {
    console.error(USAGE);
    return 2;
  }
  const folder = await stat(vault).catch(() => null);
  if (folder === null || !folder.isDirectory()) {
    console.error(`Not a folder: ${vault}`);
    return 2;
  }
  try {
    const input = meetingInputOf(JSON.parse(await readInput(source)), gemini);
    console.log((await fileMeeting(vault, input, localToday())).path);
    return 0;
  } catch (error) {
    // Bad JSON or an input no note can be written from: say why, write nothing. Anything else is a bug.
    if (!(error instanceof SyntaxError || error instanceof MeetingInputError)) throw error;
    console.error(`Cannot file this meeting: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
