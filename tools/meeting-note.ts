// Files a meeting into a vault folder:
//   node tools/meeting-note.ts <vault dir> [input.json | -] [--gemini]
// Reads a meeting note's input as JSON (from the file, else stdin), writes the
// note at Meetings/<YYYY>/<MM>/<date> <title>.md, or adds to it when that file
// exists, and prints its path. A new note gets a line in the meetings queue,
// for Claude to summarize. `--gemini` reads the JSON as a "Notes by Gemini"
// meeting first. Plain Node, erasable TypeScript, no dependencies.
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MEETING_QUEUE_PATH,
  MeetingInputError,
  fromGeminiNotes,
  meetingPath,
  mergeMeetingNote,
  parseMeetingInput,
  queueMeetings,
  wallClockIn,
  type MeetingInput,
} from '../src/domain/meetings/index.ts';
import { writeIfChanged } from './vault-files.ts';

export interface FiledMeeting {
  readonly path: string;
  /** False when the note already held everything in the input. */
  readonly written: boolean;
  /** True when the note was new, and its line went into the meetings queue. */
  readonly queued: boolean;
}

/** The input a JSON value describes: a meeting note's input, or a Gemini meeting with `gemini`. */
export function meetingInputOf(json: unknown, gemini: boolean): MeetingInput {
  return gemini ? fromGeminiNotes(json) : parseMeetingInput(json);
}

/** The file's text in `vault`, or null when there is none. */
async function textAt(vault: string, path: string): Promise<string | null> {
  return readFile(join(vault, ...path.split('/')), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

/**
 * Writes the meeting's note into `vault`, merging into the note already at
 * its path. A new note is queued for Claude, added on `today` (`YYYY-MM-DD`).
 */
export async function fileMeeting(
  vault: string,
  input: MeetingInput,
  today: string,
): Promise<FiledMeeting> {
  const path = meetingPath(input);
  const existing = await textAt(vault, path);
  const written = await writeIfChanged(vault, path, mergeMeetingNote(existing ?? '', input));
  const queued = existing === null && written;
  if (queued) {
    const queue = queueMeetings(await textAt(vault, MEETING_QUEUE_PATH), [{ path, added: today }]);
    await writeIfChanged(vault, MEETING_QUEUE_PATH, queue);
  }
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
