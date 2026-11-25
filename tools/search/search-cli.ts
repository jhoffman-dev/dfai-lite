// The search command Claude runs in a vault. It ships as one file with no
// imports but Node's (tools/search/search.mjs, built by
// tools/search/build-search.ts) and reads the notes straight from disk on
// every run, so it is never stale and needs no index.
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  isSearchedPath,
  isSkippedRootFolder,
  searchNotes,
  type SearchableNote,
} from '../../src/domain/note-search/index.ts';
import { listFiles } from '../vault-files.ts';
import { parseSearchArgs, USAGE } from './search-args.ts';
import { formatResult } from './search-output.ts';

/** Files read at once: enough to keep the disk busy, few enough to stay clear of the open-file limit. */
const READ_BATCH = 64;

/** Where a run is and what it may print to. */
export interface SearchRun {
  readonly argv: readonly string[];
  /** The script's own path: one in `<vault>/.dfai-lite/` searches that vault. */
  readonly scriptPath: string;
  readonly cwd: string;
  readonly nowMs: number;
  readonly print: (text: string) => void;
  readonly printError: (text: string) => void;
}

/** Runs one search and prints it. The exit code: 0 searched (found or not), 2 a usage or vault problem. */
export async function runSearch(run: SearchRun): Promise<number> {
  const parsed = parseSearchArgs(run.argv, run.nowMs);
  if (parsed.kind === 'help') {
    run.print(`${USAGE}\n`);
    return 0;
  }
  if (parsed.kind === 'error') {
    run.printError(`${parsed.message}\n${USAGE}\n`);
    return 2;
  }
  const { query, filters, limit } = parsed.args;
  const vault = parsed.args.vault ?? vaultOf(run);
  const found = await stat(vault).catch(() => null);
  if (found === null || !found.isDirectory()) {
    run.printError(`Not a folder: ${vault}\n`);
    return 2;
  }
  const notes = await readNotes(vault, filters.transcripts === true);
  const result = searchNotes({ notes, query, filters, limit });
  run.print(formatResult(result, { query, titleOnly: filters.titleOnly === true }));
  return 0;
}

/** The vault a run searches: the one the script lives in, else the folder it runs in. */
function vaultOf({ scriptPath, cwd }: SearchRun): string {
  const folder = dirname(resolve(scriptPath));
  return basename(folder) === '.dfai-lite' ? dirname(folder) : cwd;
}

/** Every note a search reads, with its text and file time, read a batch at a time. */
export async function readNotes(vault: string, transcripts: boolean): Promise<SearchableNote[]> {
  const scope = { transcripts };
  const files = (await listFiles(vault, (name) => isSkippedRootFolder(name, scope))).filter(
    ({ path }) => isSearchedPath(path, scope),
  );
  const notes: SearchableNote[] = [];
  for (let at = 0; at < files.length; at += READ_BATCH) {
    const batch = files.slice(at, at + READ_BATCH);
    notes.push(
      ...(await Promise.all(
        batch.map(async ({ path, absolute }) => {
          const [text, info] = await Promise.all([readFile(absolute, 'utf8'), stat(absolute)]);
          return { path, text, modifiedMs: info.mtimeMs };
        }),
      )),
    );
  }
  return notes;
}
