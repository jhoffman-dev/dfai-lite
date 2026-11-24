// Makes a DFAI Lite vault from a DFAI vault, leaving the source untouched:
// `node tools/prepare-lite-vault.ts <dfai vault dir> <new empty output dir>`.
// Leaves out tasks, automation proposals and DFAI's machinery, takes the
// bookkeeping out of the frontmatter, merges a person kept twice, runs the
// migration (frontmatter → inline tags, links and lines), then moves folders
// into DFAI Lite's layout with every link re-pointed. Plain Node, erasable TS.
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAVORITES_PATH,
  parseFavorites,
  serializeFavorites,
} from '../src/domain/favorites/index.ts';
import { fileNameOf, folderOf, isNotePath, type PathMove } from '../src/domain/vault/index.ts';
import { buildIndex } from './build-index.ts';
import { convertNote } from './dfai-convert.ts';
import { readFrontmatter } from './frontmatter.ts';
import {
  layoutMoves,
  leftOutReason,
  mergedPersonNote,
  tidyFrontmatter,
  withoutDfaiMarkers,
} from './lite-vault-rules.ts';
import { MigrationRefused, migrate, reportLines } from './migrate-from-dfai.ts';
import { REPORT_PATH, reconciles } from './migration-report.ts';
import { relocate, type VaultInMemory } from './relocate-notes.ts';
import { listFiles, scanFolder } from './vault-files.ts';

/** Where the migration's report ends up: kept, but out of the way. */
export const PREPARED_REPORT_PATH = 'Archive/DFAI migration report.md';
const SOURCE_SKIPS = new Set(['.git', '.atlas-cache', 'node_modules', '_index']);
/** Folders of DFAI Lite's layout that are kept in git even with nothing in them yet. */
const KEPT_FOLDERS = ['Inbox', 'Projects', 'Areas', 'Resources', 'Archive', 'People', 'skills'];
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export interface PreparationReport {
  readonly leftOut: readonly { readonly path: string; readonly reason: string }[];
  /** Bookkeeping properties taken out, counted by key. */
  readonly propertiesRemoved: ReadonlyMap<string, number>;
  /** DFAI marker comment lines taken out of note bodies. */
  readonly markersRemoved: number;
  /** Each person kept twice, merged: the note that was folded into the People one. */
  readonly merged: readonly string[];
  readonly moves: readonly PathMove[];
  readonly linksRewritten: number;
  readonly imagesRewritten: number;
  readonly migrationLines: readonly string[];
  readonly reconciles: boolean;
  readonly notes: number;
}

/** A staged note: its path in the source, the type it had in DFAI, and its text with bookkeeping out. */
interface StagedNote {
  readonly path: string;
  readonly type: string | undefined;
  readonly text: string;
}

interface Staged {
  readonly notes: StagedNote[];
  readonly files: { readonly path: string; readonly absolute: string }[];
  readonly leftOut: { path: string; reason: string }[];
  readonly propertiesRemoved: Map<string, number>;
  markersRemoved: number;
  readonly merged: string[];
}

export async function prepareLiteVault(source: string, output: string): Promise<PreparationReport> {
  await assertEmptyOutput(output);
  const work = await mkdtemp(join(tmpdir(), 'prepare-lite-vault-'));
  try {
    const staged = mergeDuplicatePeople(await stage(source));
    const staging = join(work, 'staging');
    await writeStaged(staging, staged);
    const migrated = join(work, 'migrated');
    const migration = await migrate(staging, migrated);
    const vault = await readVault(migrated);
    const typeOf = new Map(staged.notes.map(({ path, type }) => [path, type]));
    const moves: PathMove[] = [
      { from: REPORT_PATH, to: PREPARED_REPORT_PATH },
      ...layoutMoves(
        [...vault.notes.keys()].map((path) => ({ path, type: typeOf.get(path) })),
        [...vault.notes.keys(), ...vault.files],
      ),
    ];
    const relocated = relocate(vault, moves);
    const report: PreparationReport = {
      leftOut: staged.leftOut,
      propertiesRemoved: staged.propertiesRemoved,
      markersRemoved: staged.markersRemoved,
      merged: staged.merged,
      moves,
      linksRewritten: relocated.linksRewritten,
      imagesRewritten: relocated.imagesRewritten,
      migrationLines: reportLines(migration, output),
      reconciles: reconciles(migration.totals),
      notes: relocated.vault.notes.size,
    };
    const origin = new Map([...relocated.moved].map(([from, to]) => [to, from]));
    await writeVault(output, relocated.vault, (path) => join(migrated, origin.get(path) ?? path));
    await appendToReport(output, report);
    await buildIndex(output);
    return report;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Reads the source once, deciding for each file whether it comes across and in what form. */
async function stage(source: string): Promise<Staged> {
  const { files } = await scanFolder(source, SOURCE_SKIPS);
  const staged: Staged = {
    notes: [],
    files: [],
    leftOut: [],
    propertiesRemoved: new Map(),
    markersRemoved: 0,
    merged: [],
  };
  for (const file of files) {
    const text = isNotePath(file.path) ? decoded(await readFile(file.absolute)) : null;
    const type = text === null ? undefined : noteType(text);
    const reason = leftOutReason(file.path, type);
    if (reason !== null) {
      staged.leftOut.push({ path: file.path, reason });
    } else if (text === null) {
      staged.files.push(file);
    } else {
      const { text: tidied, removed } = tidyFrontmatter(text);
      const { text: kept, count } = withoutDfaiMarkers(tidied);
      staged.markersRemoved += count;
      for (const key of removed) {
        staged.propertiesRemoved.set(key, (staged.propertiesRemoved.get(key) ?? 0) + 1);
      }
      staged.notes.push({ path: file.path, type, text: kept });
    }
  }
  return staged;
}

function noteType(text: string): string | undefined {
  const type = readFrontmatter(text).properties.get('type');
  return typeof type === 'string' ? type : undefined;
}

const decoded = (bytes: Buffer): string | null => {
  try {
    return UTF8.decode(bytes);
  } catch {
    // Not UTF-8: staged as a plain file, which the migration copies and reports.
    return null;
  }
};

/** A person note at the vault's root whose name is also in `People/` becomes one note there. */
function mergeDuplicatePeople(staged: Staged): Staged {
  const byPath = new Map(staged.notes.map((note) => [note.path, note]));
  const merged: string[] = [];
  for (const note of staged.notes) {
    if (folderOf(note.path) !== '' || note.type !== 'person') continue;
    const twinPath = `People/${fileNameOf(note.path)}`;
    const twin = byPath.get(twinPath);
    if (twin === undefined) continue;
    byPath.set(twinPath, { ...twin, text: mergedPersonNote(versions(note), versions(twin)) });
    byPath.delete(note.path);
    merged.push(note.path);
  }
  return { ...staged, notes: [...byPath.values()], merged };
}

const versions = ({ path, text }: StagedNote) => ({
  raw: text,
  converted: convertNote({ path, text }).text,
});

async function writeStaged(staging: string, staged: Staged): Promise<void> {
  await mkdir(staging, { recursive: true });
  for (const { path, text } of staged.notes) await writeInto(staging, path, text);
  for (const { path, absolute } of staged.files) await copyInto(staging, path, absolute);
}

/** The migrated vault in memory: its notes, its other files, and its favorites. */
async function readVault(folder: string): Promise<VaultInMemory> {
  const notes = new Map<string, string>();
  const files: string[] = [];
  let favorites: readonly string[] = [];
  for (const { path, absolute } of await listFiles(folder)) {
    if (path === FAVORITES_PATH) {
      favorites = parseFavorites(await readFile(absolute, 'utf8')).favorites;
    } else if (isNotePath(path) && !path.startsWith('.')) {
      notes.set(path, await readFile(absolute, 'utf8'));
    } else {
      files.push(path);
    }
  }
  return { notes, files, favorites };
}

async function writeVault(
  output: string,
  vault: VaultInMemory,
  sourceOf: (path: string) => string,
): Promise<void> {
  for (const [path, text] of vault.notes) await writeInto(output, path, text);
  for (const path of vault.files) await copyInto(output, path, sourceOf(path));
  if (vault.favorites.length > 0) {
    await writeInto(output, FAVORITES_PATH, serializeFavorites(vault.favorites));
  }
  await writeInto(output, '.gitignore', '.DS_Store\n');
  const taken = [...vault.notes.keys(), ...vault.files];
  for (const folder of KEPT_FOLDERS) {
    if (!taken.some((path) => path.startsWith(`${folder}/`))) {
      await writeInto(output, `${folder}/.gitkeep`, '');
    }
  }
}

async function appendToReport(output: string, report: PreparationReport): Promise<void> {
  const path = join(output, ...PREPARED_REPORT_PATH.split('/'));
  const before = await readFile(path, 'utf8');
  await writeFile(
    path,
    `${before.replace(/\n*$/, '')}\n\n${preparationLines(report).join('\n')}\n`,
  );
}

/** The preparation's own part of the report: what was left out, removed, merged and moved. */
export function preparationLines(report: PreparationReport): string[] {
  const reasons = new Map<string, number>();
  for (const { reason } of report.leftOut) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  return [
    '## Prepared for DFAI Lite',
    '',
    `Left out: ${report.leftOut.length} files.`,
    ...[...reasons].map(([reason, count]) => `- ${reason}: ${count}`),
    '',
    'Bookkeeping properties removed:',
    ...[...report.propertiesRemoved].map(([key, count]) => `- ${key}: ${count}`),
    '',
    `DFAI marker comments removed: ${report.markersRemoved}.`,
    '',
    `People merged into their People note: ${report.merged.length === 0 ? 'none' : report.merged.join(', ')}.`,
    '',
    'Moved into the layout:',
    ...report.moves.map(({ from, to }) => `- ${from} → ${to}`),
    '',
    `Links re-pointed: ${report.linksRewritten}. Images re-pointed: ${report.imagesRewritten}. Notes: ${report.notes}.`,
  ];
}

async function assertEmptyOutput(output: string): Promise<void> {
  const entries = await readdir(output).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (entries.length > 0) throw new PreparationRefused(`The output folder is not empty: ${output}`);
}

export class PreparationRefused extends Error {
  override readonly name = 'PreparationRefused';
}

async function copyInto(root: string, path: string, from: string): Promise<void> {
  const to = join(root, ...path.split('/'));
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function writeInto(root: string, path: string, text: string): Promise<void> {
  const to = join(root, ...path.split('/'));
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, text, 'utf8');
}

async function main(args: readonly string[]): Promise<number> {
  const [source, output] = args;
  if (source === undefined || output === undefined || args.length !== 2) {
    console.error(
      'Usage: node tools/prepare-lite-vault.ts <dfai vault dir> <new empty output dir>',
    );
    return 2;
  }
  try {
    const report = await prepareLiteVault(source, output);
    console.log([...report.migrationLines, '', ...preparationLines(report)].join('\n'));
    console.log(`Report written to ${join(output, PREPARED_REPORT_PATH)}.`);
    return report.reconciles ? 0 : 1;
  } catch (error) {
    if (!(error instanceof PreparationRefused) && !(error instanceof MigrationRefused)) throw error;
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
