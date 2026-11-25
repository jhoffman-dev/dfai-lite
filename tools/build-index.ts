// Writes `_index/` for a vault folder: `node tools/build-index.ts <vault dir>`.
// It is what the vault's GitHub Action runs, so it has no dependencies and
// uses only TypeScript that Node can strip (no enums, no parameter properties).
import { lstat, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INDEX_ROOT,
  README_PATH,
  SEARCH_SCRIPT_PATH,
  buildAiIndex,
  vaultReadme,
} from '../src/domain/ai-index/index.ts';
import { isVaultGuide, isVisibleNote } from '../src/domain/vault/index.ts';
import {
  UnsafePathRefused,
  changeFile,
  listFiles,
  readMarkdown,
  removeFile,
  writeIfChanged,
} from './vault-files.ts';

export interface IndexRun {
  readonly notes: number;
  readonly files: number;
  readonly written: number;
  readonly removed: number;
  /** What happened to the map in the root README: written, unchanged, or why it was left alone. */
  readonly readme: 'written' | 'unchanged' | { readonly refused: string };
  /** Whether `.dfai-lite/search.mjs` was written (new, or a newer version). */
  readonly searchScriptWritten: boolean;
}

/** The search command a vault gets, built beside this file (tools/search/build-search.ts). */
const SEARCH_SCRIPT_SOURCE = fileURLToPath(new URL('./search/search.mjs', import.meta.url));

/**
 * Regenerates `<vault>/_index/` (writes what changed, deletes what the index
 * no longer has), the map in the root `README.md`, and the vault's copy of
 * the search command.
 */
export async function buildIndex(vault: string): Promise<IndexRun> {
  await assertIndexFolder(vault);
  const notes = await readMarkdown(vault);
  const files = buildAiIndex(notes);
  let written = 0;
  for (const { path, text } of files) {
    if (await writeIfChanged(vault, path, text)) written += 1;
  }
  const wanted = new Set(files.map(({ path }) => path));
  const indexFolder = resolve(vault, INDEX_ROOT);
  const existing = await listFiles(indexFolder, new Set()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  let removed = 0;
  for (const { path } of existing) {
    const vaultPath = `${INDEX_ROOT}/${path}`;
    if (wanted.has(vaultPath)) continue;
    await removeFile(vault, vaultPath, INDEX_ROOT);
    removed += 1;
  }
  const indexed = notes.filter(({ path }) => isVisibleNote(path) && !isVaultGuide(path)).length;
  const readme = await writeReadmeMap(vault, notes);
  const searchScriptWritten = await writeIfChanged(
    vault,
    SEARCH_SCRIPT_PATH,
    await readFile(SEARCH_SCRIPT_SOURCE, 'utf8'),
  );
  return { notes: indexed, files: files.length, written, removed, readme, searchScriptWritten };
}

/** Rewrites the generated map in the README; text outside its markers is never changed. */
async function writeReadmeMap(
  vault: string,
  notes: readonly { path: string; text: string }[],
): Promise<IndexRun['readme']> {
  let refused: string | null = null;
  const changed = await changeFile(vault, README_PATH, (current) => {
    const update = vaultReadme(current, notes);
    if (update.kind === 'write') return update.text;
    refused = update.reason;
    return current ?? '';
  });
  if (refused !== null) return { refused };
  return changed ? 'written' : 'unchanged';
}

/**
 * Refuses an `_index` that is not a real folder inside the vault: through a
 * link, writing and deleting stale files would land somewhere else entirely.
 */
async function assertIndexFolder(vault: string): Promise<void> {
  const found = await lstat(resolve(vault, INDEX_ROOT)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (found === null || (found.isDirectory() && !found.isSymbolicLink())) return;
  const what = found.isSymbolicLink() ? 'a symbolic link' : 'not a folder';
  throw new UnsafePathRefused(
    `${INDEX_ROOT} in ${vault} is ${what}: refusing to write the index. Remove it and run again.`,
  );
}

/** The one line a run prints about `_index/`. */
export const runSummary = ({ notes, files, written, removed }: IndexRun): string =>
  `Indexed ${notes} notes into ${files} files in ${INDEX_ROOT}/: ${written} written, ${removed} removed.`;

/** The line a run prints about the README map and the search command. */
export function guidesSummary({ readme, searchScriptWritten }: IndexRun): string {
  const map =
    typeof readme === 'string' ? `${README_PATH} map ${readme}` : `Warning: ${readme.refused}`;
  return `${map}; ${SEARCH_SCRIPT_PATH} ${searchScriptWritten ? 'written' : 'unchanged'}.`;
}

async function main(args: readonly string[]): Promise<number> {
  const [vault] = args;
  if (vault === undefined || args.length !== 1) {
    console.error('Usage: node tools/build-index.ts <vault dir>');
    return 2;
  }
  const folder = await stat(vault).catch(() => null);
  if (folder === null || !folder.isDirectory()) {
    console.error(`Not a folder: ${vault}`);
    return 2;
  }
  try {
    const run = await buildIndex(vault);
    console.log(runSummary(run));
    console.log(guidesSummary(run));
    return 0;
  } catch (error) {
    if (!(error instanceof UnsafePathRefused)) throw error;
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
