// What a DFAI → DFAI Lite migration did, and how it is printed. Its totals
// must reconcile: every file the source holds was converted, copied or
// skipped with a reason. Plain Node, erasable TypeScript only.
import { runSummary, type IndexRun } from './build-index.ts';
import type { ConversionRule } from './dfai-convert.ts';

/** Where the migration's report is written in the new vault (the index leaves it out). */
export const REPORT_PATH = 'MIGRATION-REPORT.md';

/** A source file (or link) left out of the new vault, and why. */
export interface SkippedFile {
  readonly path: string;
  readonly reason: string;
  /** Set for folders reported as one line with a count (`.git/`), not file by file. */
  readonly folder?: string;
}

/** A note and the keys (or lines) a rule applied to. */
export interface NoteKeys {
  readonly path: string;
  readonly keys: readonly string[];
}

export interface MigrationTotals {
  /** Files and links found in the source, every folder walked, no link followed. */
  readonly seen: number;
  /** Markdown notes written with their frontmatter converted (or as they were, if they had none). */
  readonly converted: number;
  /** Files copied byte for byte. */
  readonly copied: number;
  readonly skipped: number;
}

export interface MigrationReport {
  readonly counts: Readonly<
    Record<ConversionRule | 'template' | 'copied' | 'favorite' | 'linksRewritten', number>
  >;
  readonly totals: MigrationTotals;
  /** Every note that lost a property, and which. */
  readonly dropped: readonly NoteKeys[];
  /** Every note that had empty properties (`[]`, no value), left out. */
  readonly empty: readonly NoteKeys[];
  /** Frontmatter kept verbatim in an "Unconverted DFAI properties" block, by note. */
  readonly unconverted: readonly NoteKeys[];
  /** Frontmatter comments by note. */
  readonly comments: readonly { readonly path: string; readonly count: number }[];
  /** Notes a UTF-8 byte-order mark was taken off. */
  readonly bomRemoved: readonly string[];
  /** Markdown files that are not valid UTF-8, copied byte for byte and not converted. */
  readonly notUtf8: readonly string[];
  readonly skipped: readonly SkippedFile[];
  /** `from → to` for every note whose new path was already taken. */
  readonly collisions: readonly string[];
  readonly templateFiles: readonly string[];
  readonly index: IndexRun;
}

/** Whether every file seen is accounted for exactly once. */
export const reconciles = ({ seen, converted, copied, skipped }: MigrationTotals): boolean =>
  seen === converted + copied + skipped;

/** What the tool prints: totals, counts by rule, then every note or file a rule touched. */
export function reportLines(report: MigrationReport, output: string): string[] {
  const { counts, totals } = report;
  return [
    `Migrated into ${output}:`,
    `  Totals: ${totals.seen} source files seen = ${totals.converted} notes converted + ${totals.copied} files copied as-is + ${totals.skipped} skipped. ${reconciles(totals) ? 'Reconciled.' : 'DOES NOT RECONCILE: some files are unaccounted for.'}`,
    `  ${counts.meeting} meetings → Meetings/<YYYY>/<MM>/, ${counts.person} people → People/, ${counts.frontmatter} other notes had frontmatter converted, ${counts.plain} notes copied as they were, ${counts.template} templates → Templates/.`,
    `  ${counts.copied} other files copied, ${counts.favorite} favorites, ${counts.linksRewritten} links re-pointed after moves.`,
    `  From the template: ${report.templateFiles.length === 0 ? 'nothing (the vault had its own)' : report.templateFiles.join(', ')}.`,
    `  ${runSummary(report.index)}`,
    `Properties dropped, by key: ${countByKey(report.dropped)}. By note (${report.dropped.length}):`,
    ...noteKeyLines(report.dropped),
    `Empty properties left out, by key: ${countByKey(report.empty)}. By note (${report.empty.length}):`,
    ...noteKeyLines(report.empty),
    `Frontmatter not converted, kept verbatim in the note (${report.unconverted.length}):`,
    ...noteKeyLines(report.unconverted),
    `Frontmatter comments (${sum(report.comments)}; whole lines kept in the unconverted block, after a value dropped):`,
    ...report.comments.map(({ path, count }) => `  ${path}: ${count}`),
    `Byte-order mark removed (${report.bomRemoved.length}):`,
    ...report.bomRemoved.map((path) => `  ${path}`),
    `Not valid UTF-8, copied byte for byte and not converted (${report.notUtf8.length}):`,
    ...report.notUtf8.map((path) => `  ${path}`),
    `Skipped (${report.skipped.length}):`,
    ...skippedLines(report.skipped),
    `Name collisions (${report.collisions.length}):`,
    ...report.collisions.map((line) => `  ${line}`),
  ];
}

/** The report as the note written into the new vault. */
export function reportNote(report: MigrationReport, output: string): string {
  const lines = reportLines(report, output);
  return `# Migration from DFAI\n\n\`\`\`text\n${lines.join('\n')}\n\`\`\`\n`;
}

const noteKeyLines = (notes: readonly NoteKeys[]): string[] =>
  notes.map(({ path, keys }) => `  ${path}: ${keys.join(', ')}`);

const sum = (notes: readonly { count: number }[]): number =>
  notes.reduce((total, { count }) => total + count, 0);

/** Skipped files by reason: a summarized folder as one line with its count, anything else path by path. */
function skippedLines(skipped: readonly SkippedFile[]): string[] {
  const byReason = new Map<string, SkippedFile[]>();
  for (const file of skipped) {
    const group = byReason.get(file.reason);
    if (group === undefined) byReason.set(file.reason, [file]);
    else group.push(file);
  }
  const lines: string[] = [];
  for (const [reason, files] of byReason) {
    lines.push(`  ${reason} (${files.length}):`);
    const folders = new Map<string, number>();
    for (const { path, folder } of files) {
      if (folder === undefined) lines.push(`    ${path}`);
      else folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
    for (const [folder, count] of folders) lines.push(`    ${folder}/ (${count} files)`);
  }
  return lines;
}

function countByKey(notes: readonly NoteKeys[]): string {
  const counts = new Map<string, number>();
  for (const { keys } of notes) for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  if (counts.size === 0) return 'none';
  return [...counts]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, count]) => `${key} ${count}`)
    .join(', ');
}
