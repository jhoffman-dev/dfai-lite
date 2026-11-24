// What a DFAI vault keeps on its way to DFAI Lite, before the migration
// converts it: which files are left out, which properties are bookkeeping,
// how a duplicate person note is merged, and where folders go afterwards.
// Pure, so the rules are tested without a file system.
import { fileNameOf, folderOf, joinPath, type PathMove } from '../src/domain/vault/index.ts';
import { readFrontmatter, type FrontmatterValue } from './frontmatter.ts';

/** Note types DFAI Lite has no use for: task notes and DFAI's automation proposals. */
const LEFT_OUT_TYPES: ReadonlyMap<string, string> = new Map([
  ['task', 'task note'],
  ['proposal', 'automation proposal'],
]);

/** Folders that hold only tasks, proposals or DFAI's own sync conflicts. */
const LEFT_OUT_FOLDERS: ReadonlyMap<string, string> = new Map([
  ['Tasks', 'task folder'],
  ['Archive/Tasks', 'task folder'],
  ['Inbox/Proposals', 'automation proposals'],
  ['Archive/Inbox', 'archived automation proposals'],
  ['Sync conflicts', "DFAI's sync conflicts"],
]);

const ATLAS_TEMPLATES = '.atlas/templates/';
/** Templates for things that do not come across. */
const LEFT_OUT_TEMPLATES = new Set(['Task.md', 'Dashboard.md']);
/** Files the new vault writes for itself. */
const LEFT_OUT_FILES = new Set(['.gitignore']);

/**
 * Why a source file is left out of the new vault, or null when it is kept.
 * `type` is the note's `type:` property, when it is a note that has one.
 */
export function leftOutReason(path: string, type: string | undefined): string | null {
  if (fileNameOf(path) === '.DS_Store') return 'Finder state';
  if (LEFT_OUT_FILES.has(path)) return 'written fresh by the new vault';
  for (const [folder, reason] of LEFT_OUT_FOLDERS) {
    if (path.startsWith(`${folder}/`)) return reason;
  }
  if (path.startsWith('.atlas/')) {
    const name = path.slice(ATLAS_TEMPLATES.length);
    const isTemplate = path.startsWith(ATLAS_TEMPLATES) && !name.includes('/');
    if (!isTemplate) return 'DFAI automations and settings';
    if (LEFT_OUT_TEMPLATES.has(name)) return 'template for a left-out note type';
    return null;
  }
  return type === undefined ? null : (LEFT_OUT_TYPES.get(type) ?? null);
}

/** Properties that only DFAI, Notion or the task list needed. */
const BOOKKEEPING_PROPERTIES = new Set([
  'tasks',
  'project_tasks',
  'Notes_tasks',
  'notion_id',
  'notion_title',
  'notion_date',
  'para',
  'para_before_archive',
  'archived',
  'archivedFrom',
]);

/** A top-level `key:` line in frontmatter, as DFAI writes it (plain keys). */
const TOP_LEVEL_KEY = /^([A-Za-z_][\w-]*)[ \t]*:(.*)$/;
/** A line that goes on the key above it: indented, or a `- item` of its list. */
const CONTINUATION = /^(?:[ \t]|-(?:[ \t]|$))/;

/**
 * The properties a reader of the new vault does not need: bookkeeping,
 * a `source` that only says Notion, and a meeting's `people` when every one
 * of them is already an attendee (the meeting's `With:` line names them).
 */
export function propertiesToRemove(properties: ReadonlyMap<string, FrontmatterValue>): Set<string> {
  const remove = new Set([...properties.keys()].filter((key) => BOOKKEEPING_PROPERTIES.has(key)));
  if (properties.get('source') === 'notion') remove.add('source');
  if (properties.get('type') === 'meeting' && peopleAreAttendees(properties)) remove.add('people');
  return remove;
}

function peopleAreAttendees(properties: ReadonlyMap<string, FrontmatterValue>): boolean {
  const people = properties.get('people');
  const attendees = properties.get('attendees');
  if (!Array.isArray(people) || !Array.isArray(attendees)) return false;
  const names = new Set(
    attendees.map((entry) => (typeof entry === 'string' ? entry : String(entry['name'] ?? ''))),
  );
  return people.every(
    (person) => typeof person === 'string' && names.has(person.replace(/^\[\[|\]\]$/g, '')),
  );
}

/**
 * The note's frontmatter without the properties a reader does not need (see
 * `propertiesToRemove`), each with its whole value, and `source_url` written
 * as `source` when no other source is left. Everything else stays byte for
 * byte; a note with no frontmatter comes back unchanged.
 */
export function tidyFrontmatter(text: string): { text: string; removed: string[] } {
  const lines = text.split('\n');
  if (lines[0]?.replace(/\r$/, '') !== '---') return { text, removed: [] };
  const close = lines.findIndex((line, at) => at > 0 && /^---[ \t]*\r?$/.test(line));
  if (close === -1) return { text, removed: [] };
  const remove = propertiesToRemove(readFrontmatter(text).properties);
  const keys = new Set<string>();
  const kept: string[] = [];
  let dropping = false;
  for (const line of lines.slice(1, close)) {
    const key = TOP_LEVEL_KEY.exec(line.replace(/\r$/, ''))?.[1];
    if (key !== undefined) {
      dropping = remove.has(key);
      if (!dropping) keys.add(key);
    } else if (!CONTINUATION.test(line)) {
      dropping = false;
    }
    if (!dropping) kept.push(line);
  }
  const renamed = keys.has('source')
    ? kept
    : kept.map((line) => line.replace(/^source_url([ \t]*:)/, 'source$1'));
  const changed = remove.size > 0 || renamed.some((line, at) => line !== kept[at]);
  if (!changed) return { text, removed: [] };
  return { text: [lines[0], ...renamed, ...lines.slice(close)].join('\n'), removed: [...remove] };
}

/** DFAI's marker comments (`<!-- atlas:summary v1 -->`), each on a line of its own. */
const DFAI_MARKER = /^[ \t]*<!-- ?atlas:[^>\n]*-->[ \t]*\r?\n(?:[ \t]*\r?\n)?/gm;

/** The note without DFAI's marker lines (and the blank line after each); the count removed. */
export function withoutDfaiMarkers(text: string): { text: string; count: number } {
  let count = 0;
  const cleaned = text.replace(DFAI_MARKER, () => {
    count += 1;
    return '';
  });
  return { text: cleaned, count };
}

/** A DFAI note as written, and as the migration converts it (no frontmatter). */
export interface NoteVersions {
  readonly raw: string;
  readonly converted: string;
}

/**
 * Two notes for one person as a single note: the fuller one whole, then the
 * other one converted, under a heading, so nothing either held is lost. On a
 * tie the first wins.
 */
export function mergedPersonNote(first: NoteVersions, second: NoteVersions): string {
  const [primary, other] =
    first.raw.length >= second.raw.length ? [first, second] : [second, first];
  const body = other.converted.trim();
  if (body === '') return primary.raw;
  return `${primary.raw.replace(/\n*$/, '')}\n\n## Also recorded as\n\n${body}\n`;
}

/** Where the folders of a DFAI vault go in DFAI Lite's layout, in the order applied. */
export const FOLDER_MOVES: readonly PathMove[] = [
  { from: 'Companies', to: 'Resources/Companies' },
  { from: 'Teams', to: 'Resources/Teams' },
  { from: 'Terms', to: 'Resources/Glossary' },
  { from: 'Chats', to: 'Resources/Chats' },
  { from: 'Notes', to: 'Resources/Notes' },
  { from: 'artifacts', to: 'Resources/Artifacts' },
];

/** Folders for the notes DFAI kept at the vault's root, by type; any other type goes to the Inbox. */
const ROOT_NOTE_FOLDERS: ReadonlyMap<string, string> = new Map([
  ['decision', 'Resources/Decisions'],
]);
const INBOX = 'Inbox';

/**
 * The moves that give the migrated vault its layout: each DFAI folder that
 * exists, then each note left at the root (by its DFAI type) into a folder.
 * `notes` are the migrated vault's note paths with the type each had in DFAI.
 */
export function layoutMoves(
  notes: readonly { readonly path: string; readonly type: string | undefined }[],
  files: readonly string[],
): PathMove[] {
  const exists = (folder: string): boolean => files.some((path) => path.startsWith(`${folder}/`));
  const folderMoves = FOLDER_MOVES.filter(({ from }) => exists(from));
  const rootMoves = notes
    .filter(({ path }) => folderOf(path) === '' && path.toLowerCase().endsWith('.md'))
    .filter(({ path }) => !ROOT_FILES.has(path))
    .map(({ path, type }) => ({
      from: path,
      to: joinPath(ROOT_NOTE_FOLDERS.get(type ?? '') ?? INBOX, path),
    }));
  return [...folderMoves, ...rootMoves];
}

/** Notes at the root that belong there: the vault's own instructions and the migration's report. */
const ROOT_FILES = new Set(['CLAUDE.md', 'MIGRATION-REPORT.md']);
