import { fileNameOf, folderOf, foldedPath, joinPath, type VaultPath } from '../vault/index.ts';

/** A calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** `date` as `YYYY-MM-DD` in the device's own time zone: the day the person sees. */
export function isoDate(date: Date): IsoDate {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Characters a Mac's name cannot carry into a file name. */
const UNSAFE_IN_NAME = /[/\\:\0\n\r\t]/g;
/** A Mac's name is cut to this many characters in a copy's name. */
const MAX_MAC_LABEL = 40;

/** A Mac's name as a copy's name carries it: safe in a file name, never empty. */
export function macLabel(mac: string): string {
  const safe = [...mac.replace(UNSAFE_IN_NAME, '-').trim()].slice(0, MAX_MAC_LABEL).join('').trim();
  return safe === '' ? 'another Mac' : safe;
}

/** `<stem> (<label>)<ext>` beside `path`, numbered ` 2`, ` 3`… past every taken name, case aside. */
function besideWithLabel(path: VaultPath, label: string, taken: Iterable<VaultPath>): VaultPath {
  const file = fileNameOf(path);
  const dot = file.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ''];
  const used = new Set<string>();
  for (const other of taken) used.add(foldedPath(other));
  for (let number = 1; ; number += 1) {
    const suffix = ` (${label})${number === 1 ? '' : ` ${number}`}`;
    const candidate = joinPath(folderOf(path), `${stem}${suffix}${extension}`);
    if (!used.has(foldedPath(candidate))) return candidate;
  }
}

/**
 * Where a sync keeps the other Mac's version of a file both Macs changed:
 * `<name> (conflict from <Mac>).md` beside it. This Mac's version stays at
 * the path.
 */
export function conflictCopyPath({
  path,
  mac,
  taken,
}: {
  path: VaultPath;
  /** The Mac the other version came from. */
  mac: string;
  /** Every path in the vault, and every copy already planned, so none is overwritten. */
  taken: Iterable<VaultPath>;
}): VaultPath {
  return besideWithLabel(path, `conflict from ${macLabel(mac)}`, taken);
}

/**
 * Where an edit goes when its note changed on disk while it was typed (a
 * sync, Claude, another editor): `<name> (conflict <date>).md` beside it.
 */
export function editConflictCopyPath({
  path,
  date,
  taken,
}: {
  path: VaultPath;
  date: IsoDate;
  taken: Iterable<VaultPath>;
}): VaultPath {
  return besideWithLabel(path, `conflict ${date}`, taken);
}

const CONFLICT_COPY = new RegExp(
  ` \\((?:conflict \\d{4}-\\d{2}-\\d{2}|conflict from [^/]{1,${MAX_MAC_LABEL}}?)\\)(?: \\d+)?(?:\\.[^./]*)?$`,
  'u',
);

/** Whether a path is a conflict copy the app made: left for its owner to merge. */
export function isConflictCopyPath(path: VaultPath): boolean {
  return CONFLICT_COPY.test(path);
}
