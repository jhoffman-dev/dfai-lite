// Converts a DFAI vault into a DFAI Lite vault, leaving the source untouched:
// `node tools/migrate-from-dfai.ts <dfai vault dir> <new empty output dir>`.
// Plain Node, no dependencies, erasable TypeScript only.
import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAVORITES_PATH, serializeFavorites } from '../src/domain/favorites/index.ts';
import { moveResolvers, retargetLinks } from '../src/domain/links/index.ts';
import { foldedPath } from '../src/domain/vault/index.ts';
import { buildIndex } from './build-index.ts';
import { convertNote, uniquePath, type ConvertedNote } from './dfai-convert.ts';
import {
  REPORT_PATH,
  reconciles,
  reportLines,
  reportNote,
  type MigrationReport,
  type SkippedFile,
} from './migration-report.ts';
import { scanFolder, type FoundFile } from './vault-files.ts';

export { reportLines, type MigrationReport } from './migration-report.ts';

/** Folders at the source's root that are never part of the new vault, each reported as one line. */
const SKIPPED_ROOT_FOLDERS: ReadonlyMap<string, string> = new Map([
  ['.git', 'git history, not notes'],
  ['.atlas-cache', 'DFAI cache'],
  ['node_modules', 'packages, not notes'],
  ['_index', 'the old index (a new one is written)'],
]);
/** DFAI's own folder: its skills and templates come across, the rest is DFAI machinery. */
const ATLAS = '.atlas';
const SKILLS = `${ATLAS}/skills/`;
const TEMPLATES = `${ATLAS}/templates/`;
const TEMPLATE = fileURLToPath(new URL('../vault-template/', import.meta.url));
/** What a new vault needs from the template, when the source has none of its own. */
const TEMPLATE_FILES = ['CLAUDE.md', '.github/workflows/index.yml'];
/** Strict, and keeping a byte-order mark, so the converter sees and reports it. */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** A note read from the source and converted, before its new path is settled. */
interface ReadNote {
  readonly from: string;
  readonly converted: ConvertedNote;
  /** Set for a DFAI template: it goes to `Templates/`, whatever its type. */
  readonly template: string | undefined;
}

interface PlannedNote {
  readonly from: string;
  readonly to: string;
  readonly text: string;
  /** False for templates: they were not notes in DFAI, so links never resolved to them. */
  readonly linkable: boolean;
}

/** A file copied byte for byte: from where, to which path in the new vault. */
interface PlannedCopy {
  readonly from: FoundFile;
  readonly to: string;
}

/** Everything the source holds, sorted into what becomes of it. */
interface SourcePlan {
  readonly seen: number;
  readonly notes: ReadNote[];
  /** Copies that keep their path. */
  readonly copies: PlannedCopy[];
  /** Skills copied from `.atlas/skills/` to `skills/`: they claim a path after the notes. */
  readonly skills: PlannedCopy[];
  readonly notUtf8: string[];
  readonly skipped: SkippedFile[];
}

export async function migrate(source: string, output: string): Promise<MigrationReport> {
  await assertSafeOutput(resolve(source), resolve(output));
  await mkdir(output, { recursive: true });
  const plan = await planSource(source);
  const taken = new Set<string>([foldedPath(REPORT_PATH)]);
  const collisions: string[] = [];
  for (const copy of plan.copies) {
    taken.add(foldedPath(copy.to));
    await copyInto(output, copy.to, copy.from.absolute);
  }
  const notes = settleNotes(plan.notes, taken, collisions);
  for (const copy of plan.skills) {
    const to = claim(copy.to, copy.from.path, { taken, collisions });
    await copyInto(output, to, copy.from.absolute);
  }
  const linksRewritten = await writeNotes(output, notes);
  const settled = new Map(notes.map(({ from, to }) => [from, to]));
  const favorites = plan.notes
    .filter(({ converted, template }) => converted.favorite && template === undefined)
    .map(({ from }) => settled.get(from) ?? from);
  if (favorites.length > 0) await writeInto(output, FAVORITES_PATH, serializeFavorites(favorites));
  const templateFiles = await copyTemplate(output, taken);
  const index = await buildIndex(output);
  const report = summarize(plan, { collisions, templateFiles, index, linksRewritten, favorites });
  await writeInto(output, REPORT_PATH, reportNote(report, output));
  return report;
}

/** Walks the whole source (no link followed) and decides each file's fate; notes are read one at a time. */
async function planSource(source: string): Promise<SourcePlan> {
  const { files, passedOver } = await scanFolder(source, new Set());
  const plan: SourcePlan = {
    seen: files.length + passedOver.length,
    notes: [],
    copies: [],
    skills: [],
    notUtf8: [],
    skipped: [],
  };
  for (const { path, kind } of passedOver) {
    const skip = machinerySkip(path);
    const reason = kind === 'symlink' ? 'symbolic link, not followed' : 'not a regular file';
    plan.skipped.push(skip ?? { path, reason });
  }
  for (const file of files) await planFile(plan, file);
  return plan;
}

async function planFile(plan: SourcePlan, file: FoundFile): Promise<void> {
  const { path } = file;
  const skip = machinerySkip(path);
  if (skip !== null) {
    plan.skipped.push(skip);
  } else if (path.startsWith(SKILLS)) {
    plan.skills.push({ from: file, to: `skills/${path.slice(SKILLS.length)}` });
  } else if (!isMarkdown(path)) {
    plan.copies.push({ from: file, to: path });
  } else {
    const text = decoded(await readFile(file.absolute));
    if (text === null) {
      plan.notUtf8.push(path);
      plan.copies.push({ from: file, to: path });
      return;
    }
    const template = path.startsWith(ATLAS) ? `Templates/${basename(path)}` : undefined;
    plan.notes.push({
      from: path,
      converted: convertNote({ path: template ?? path, text }),
      template,
    });
  }
}

/** Why a path is left out, when it is: a skipped root folder, or `.atlas/` machinery; null otherwise. */
function machinerySkip(path: string): SkippedFile | null {
  const [top = '', second] = path.split('/');
  const rootReason = SKIPPED_ROOT_FOLDERS.get(top);
  if (rootReason !== undefined) return { path, reason: rootReason, folder: top };
  if (top !== ATLAS || path.startsWith(SKILLS)) return null;
  const isTemplate = path.startsWith(TEMPLATES) && !path.slice(TEMPLATES.length).includes('/');
  if (isTemplate && isMarkdown(path)) return null;
  const what = path.split('/').length > 2 ? second : 'state';
  return { path, reason: `DFAI machinery (${ATLAS}/ ${what}), not converted` };
}

const decoded = (bytes: Buffer): string | null => {
  try {
    return UTF8.decode(bytes);
  } catch {
    // Not valid UTF-8: the caller copies the bytes unconverted and reports it.
    return null;
  }
};

/** Settles each note's new path: notes that stay put claim theirs first, so a note moving in is the one renamed. */
function settleNotes(
  notes: readonly ReadNote[],
  taken: Set<string>,
  collisions: string[],
): PlannedNote[] {
  const stays = (note: ReadNote): boolean =>
    note.template === undefined && note.converted.path === note.from;
  const ordered = [...notes.filter(stays), ...notes.filter((note) => !stays(note))];
  return ordered.map(({ from, converted, template }) => ({
    from,
    to: claim(template ?? converted.path, from, { taken, collisions }),
    text: converted.text,
    linkable: template === undefined,
  }));
}

/** `wanted`, or the next free name beside it (recorded as a collision), now taken. */
function claim(
  wanted: string,
  from: string,
  { taken, collisions }: { taken: Set<string>; collisions: string[] },
): string {
  const to = uniquePath(wanted, taken);
  if (to !== wanted) collisions.push(`${from} → ${to}`);
  taken.add(foldedPath(to));
  return to;
}

function summarize(
  plan: SourcePlan,
  done: Pick<MigrationReport, 'collisions' | 'templateFiles' | 'index'> & {
    linksRewritten: number;
    favorites: readonly string[];
  },
): MigrationReport {
  const counts = { plain: 0, frontmatter: 0, meeting: 0, person: 0, template: 0 };
  for (const { converted, template } of plan.notes) {
    counts[template === undefined ? converted.rule : 'template'] += 1;
  }
  const byNote = (keys: (note: ConvertedNote) => readonly string[]) =>
    plan.notes
      .map(({ from, converted }) => ({ path: from, keys: keys(converted) }))
      .filter(({ keys: found }) => found.length > 0);
  const copied = plan.copies.length + plan.skills.length;
  return {
    counts: {
      ...counts,
      copied: copied - plan.notUtf8.length,
      favorite: done.favorites.length,
      linksRewritten: done.linksRewritten,
    },
    totals: { seen: plan.seen, converted: plan.notes.length, copied, skipped: plan.skipped.length },
    dropped: byNote(({ dropped }) => dropped),
    empty: byNote(({ empty }) => empty),
    unconverted: byNote(({ unconverted }) => unconverted),
    comments: plan.notes
      .filter(({ converted }) => converted.comments > 0)
      .map(({ from, converted }) => ({ path: from, count: converted.comments })),
    bomRemoved: plan.notes.filter(({ converted }) => converted.bom).map(({ from }) => from),
    notUtf8: plan.notUtf8,
    skipped: plan.skipped,
    collisions: done.collisions,
    templateFiles: done.templateFiles,
    index: done.index,
  };
}

/** Writes the notes at their new paths, re-pointing links a move or rename broke. Returns links rewritten. */
async function writeNotes(output: string, notes: readonly PlannedNote[]): Promise<number> {
  const linkable = notes.filter((note) => note.linkable);
  const resolvers = moveResolvers({
    before: linkable.map(({ from }) => from),
    after: linkable.map(({ to }) => to),
    moved: new Map(
      linkable.filter(({ from, to }) => from !== to).map(({ from, to }) => [from, to]),
    ),
  });
  let rewritten = 0;
  for (const note of notes) {
    const { text, count } = retargetLinks(note.text, resolvers);
    rewritten += count;
    await writeInto(output, note.to, text);
  }
  return rewritten;
}

async function copyTemplate(output: string, taken: ReadonlySet<string>): Promise<string[]> {
  const copied: string[] = [];
  for (const path of TEMPLATE_FILES) {
    if (taken.has(foldedPath(path))) continue;
    await copyInto(output, path, join(TEMPLATE, ...path.split('/')));
    copied.push(path);
  }
  return copied;
}

/** Refuses an output folder that holds anything, sits inside the source, or holds the source. */
async function assertSafeOutput(source: string, output: string): Promise<void> {
  const sourceFolder = await stat(source).catch(() => null);
  if (sourceFolder === null || !sourceFolder.isDirectory()) {
    throw new MigrationRefused(`The DFAI vault is not a folder: ${source}`);
  }
  const [realSource, realOutput] = await Promise.all([realLocation(source), realLocation(output)]);
  if (isWithin(realOutput, realSource)) {
    throw new MigrationRefused('The output folder is inside the DFAI vault: pick one outside it.');
  }
  if (isWithin(realSource, realOutput)) {
    throw new MigrationRefused('The DFAI vault is inside the output folder: pick one outside it.');
  }
  const entries = await readdir(output).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (entries.length > 0) {
    throw new MigrationRefused(`The output folder is not empty: ${output}`);
  }
}

/**
 * Where `path` really is: the real path of its nearest existing ancestor (links
 * followed) with the rest appended, so a link or a not-yet-made folder cannot hide where writes go.
 */
async function realLocation(path: string): Promise<string> {
  const rest: string[] = [];
  let existing = path;
  for (;;) {
    try {
      return join(await realpath(existing), ...rest.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || dirname(existing) === existing) throw error;
      rest.push(basename(existing));
      existing = dirname(existing);
    }
  }
}

/**
 * Whether `inner` is `outer` or inside it, ignoring case and Unicode
 * normalization: on a Mac `vault/Lite` and `Vault/Lite` are one folder.
 */
function isWithin(inner: string, outer: string): boolean {
  const fold = (path: string): string => path.normalize('NFC').toLowerCase();
  const [folderInner, folderOuter] = [fold(inner), fold(outer)];
  const prefix = folderOuter.endsWith(sep) ? folderOuter : `${folderOuter}${sep}`;
  return folderInner === folderOuter || folderInner.startsWith(prefix);
}

export class MigrationRefused extends Error {
  override readonly name = 'MigrationRefused';
}

const isMarkdown = (path: string): boolean => path.toLowerCase().endsWith('.md');

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
    console.error('Usage: node tools/migrate-from-dfai.ts <dfai vault dir> <new empty output dir>');
    return 2;
  }
  try {
    const report = await migrate(source, output);
    console.log(reportLines(report, output).join('\n'));
    console.log(`Report written to ${join(output, REPORT_PATH)}.`);
    return reconciles(report.totals) ? 0 : 1;
  } catch (error) {
    if (!(error instanceof MigrationRefused)) throw error;
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
