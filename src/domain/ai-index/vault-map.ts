import { VaultIndex } from '../index/index.ts';
import {
  TRANSCRIPTS_FOLDER,
  folderOf,
  isTranscriptPath,
  isVaultGuide,
  isVisibleNote,
  noteTitle,
  type VaultPath,
} from '../vault/index.ts';
import { TAG_FILE } from './tag-file.ts';
import { INDEX_ROOT, byCode, oneLine, type IndexFile } from './text.ts';

/** Where the search script lives in a vault: in the app's folder, so the tree never shows it. */
export const SEARCH_SCRIPT_PATH = '.dfai-lite/search.mjs';

/** Rows and items each part of the map shows at most, which keeps it well under its line budget. */
export const MAP_LIMITS = { folders: 20, busiest: 8, tags: 20, dated: 15 } as const;

/** What the vault template's folders hold, so the map can say it. Other folders name their sub-folders. */
const FOLDER_PURPOSE: Readonly<Record<string, string>> = {
  Inbox: 'Quick notes, not filed yet',
  Projects: 'Work with an end',
  Areas: 'Ongoing responsibilities',
  Resources: 'Reference material and permanent notes',
  Archive: 'Finished or dormant work',
  Meetings: 'One note per meeting, by year and month',
  People: 'One note per person',
  [TRANSCRIPTS_FOLDER]: 'Meeting transcripts, verbatim (search with --transcripts)',
};

/** A date written in a note's name: `2026-11-20 Weekly sync`. */
const DATE_IN_NAME = /\d{4}-\d{2}-\d{2}/;

const S = SEARCH_SCRIPT_PATH;
const HOW_TO_FIND = [
  '### How to find things',
  '',
  `1. This map first. Then \`${INDEX_ROOT}/README.md\`: \`${INDEX_ROOT}/folders/<folder>.md\` has one line per note (path, tags, links, first sentence), \`${TAG_FILE}\` the notes for each tag, \`${INDEX_ROOT}/meetings/<YYYY>-<MM>.md\` the meetings of a month.`,
  `2. Working in this folder, search the notes themselves (never stale; ranked, at most 10 notes, each with its matching lines):`,
  `   - \`node ${S} "rollout plan"\`: every word, in names and headings first`,
  `   - \`node ${S} '"exact phrase"' --folder Meetings --since 30d\``,
  `   - \`node ${S} --tag project --links-to "Note name"\``,
  `   \`--title\` matches names only, \`--transcripts\` adds ${TRANSCRIPTS_FOLDER}/ for verbatim quotes, \`--limit 25\` shows more, \`--help\` lists all.`,
  '3. Open a note only once its index line or search lines say it is the one. Search line numbers point into the file.',
];

/**
 * The generated part of the vault's root `README.md`: what is where, for a
 * reader who should open as little as possible. Pure and deterministic: it
 * reads only note paths and text (never file dates), so every machine that
 * builds it from the same notes writes the same bytes. The vault's guides
 * and hidden paths are left out, as the index leaves them out.
 */
export function vaultMapLines(notes: readonly IndexFile[]): readonly string[] {
  const visible = notes.filter(({ path }) => isVisibleNote(path) && !isVaultGuide(path));
  const paths = visible.map(({ path }) => path).sort(byCode);
  return [
    '## Map of this vault',
    '',
    `${paths.length} notes. This part is generated from the notes on every push and replaced each time; write above or below the markers.`,
    '',
    ...HOW_TO_FIND,
    ...folderTable(paths),
    ...busiestFolders(paths),
    ...topTags(VaultIndex.build(visible)),
    ...datedNotes(paths),
  ];
}

/** The top-level folders: notes in each, and what each holds. */
function folderTable(paths: readonly VaultPath[]): string[] {
  const counts = countBy(paths, (path) =>
    path.includes('/') ? path.slice(0, path.indexOf('/')) : '',
  );
  const rows = [...counts].sort(([a], [b]) => byCode(a, b));
  const shown = rows
    .slice(0, MAP_LIMITS.folders)
    .map(
      ([folder, count]) =>
        `| ${folder === '' ? '(vault root)' : `${cell(folder)}/`} | ${count} | ${cell(purposeOf(folder, paths))} |`,
    );
  const more = rows.length - shown.length;
  return [
    '',
    '### Folders',
    '',
    '| Folder | Notes | Holds |',
    '| --- | --- | --- |',
    ...shown,
    ...(more > 0 ? ['', `${more} more folders: see \`${INDEX_ROOT}/README.md\`.`] : []),
  ];
}

function purposeOf(folder: string, paths: readonly VaultPath[]): string {
  if (folder === '') return 'Notes not in a folder';
  const known = FOLDER_PURPOSE[folder];
  if (known !== undefined) return known;
  const children = new Set<string>();
  for (const path of paths) {
    const rest = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : '';
    if (rest.includes('/')) children.add(rest.slice(0, rest.indexOf('/')));
  }
  const names = [...children].sort(byCode);
  if (names.length === 0) return 'Notes';
  const listed = names.slice(0, 4).join(', ');
  return `Sub-folders: ${listed}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`;
}

/** The nested folders holding the most notes directly: where the activity is. */
function busiestFolders(paths: readonly VaultPath[]): string[] {
  const counts = countBy(
    paths.filter((path) => folderOf(path).includes('/')),
    folderOf,
  );
  if (counts.size === 0) return [];
  const rows = [...counts]
    .sort(([a, left], [b, right]) => right - left || byCode(a, b))
    .slice(0, MAP_LIMITS.busiest);
  return [
    '',
    '### Busiest sub-folders',
    '',
    ...rows.map(([folder, count]) => `- \`${folder}/\`: ${count}`),
  ];
}

/** The tags most used, in code spans so the app never reads this file's list as tags of its own. */
function topTags(index: VaultIndex): string[] {
  const counts = [...index.tagCounts()]
    .sort((a, b) => b.count - a.count || byCode(a.key, b.key))
    .slice(0, MAP_LIMITS.tags);
  if (counts.length === 0) return [];
  const listed = counts.map(({ name, count }) => `\`#${oneLine(name)}\` ${count}`).join(', ');
  return ['', '### Most used tags', '', `${listed}. All tags: \`${TAG_FILE}\`.`];
}

/** The newest notes with a date in their name, newest first: meetings and dated notes. */
function datedNotes(paths: readonly VaultPath[]): string[] {
  const dated = paths
    .filter((path) => !isTranscriptPath(path))
    .map((path) => ({ path, date: DATE_IN_NAME.exec(noteTitle(path))?.[0] }))
    .filter((each): each is { path: VaultPath; date: string } => each.date !== undefined)
    .sort((a, b) => byCode(b.date, a.date) || byCode(a.path, b.path))
    .slice(0, MAP_LIMITS.dated);
  if (dated.length === 0) return [];
  return [
    '',
    '### Latest dated notes',
    '',
    'By the date in the name. For notes changed lately, search with `--since 7d`.',
    '',
    ...dated.map(({ path }) => `- \`${oneLine(path)}\``),
  ];
}

function countBy(
  paths: readonly VaultPath[],
  key: (path: VaultPath) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const path of paths) counts.set(key(path), (counts.get(key(path)) ?? 0) + 1);
  return counts;
}

/** Text safe in a table cell: one line, and no `|` to split it. */
const cell = (text: string): string => oneLine(text).replace(/\|/g, '/');
