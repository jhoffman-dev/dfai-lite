import {
  APP_FOLDER,
  isWithin,
  pathAfterMove,
  type PathMove,
  type VaultPath,
} from '../vault/index.ts';
import {
  resolveHue,
  resolveIcon,
  type AppearanceHue,
  type ResolvedIcon,
} from './appearance-options.ts';

/** Where the folders' and notes' icons and colors live: an ordinary vault file, synced like a note. */
export const APPEARANCE_PATH = `${APP_FOLDER}/appearance.json`;

/** One folder's or note's look as the file holds it. Either field may name what this version does not know. */
export interface Appearance {
  readonly color?: string;
  readonly icon?: string;
}

/** Every look, by vault path (a folder's path, or a note's with its `.md`). */
export type Appearances = ReadonlyMap<VaultPath, Appearance>;

/** A look as drawn: what this version knows of it, or null for the default. */
export interface ResolvedAppearance {
  readonly hue: AppearanceHue | null;
  readonly icon: ResolvedIcon | null;
}

/**
 * The looks read from the file's text. Malformed text (not JSON, or not an
 * object) reads as no looks and says why: the app then tells the person,
 * and never writes over the file, which may hold what a newer version or a
 * hand edit meant.
 */
export type ParsedAppearances =
  | { readonly kind: 'ok'; readonly appearances: Appearances }
  | { readonly kind: 'malformed'; readonly appearances: Appearances; readonly reason: string };

const NONE: Appearances = new Map();

export function parseAppearances(text: string): ParsedAppearances {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // The text is not JSON; that is exactly what `malformed` reports.
    return {
      kind: 'malformed',
      appearances: NONE,
      reason: `${APPEARANCE_PATH} is not valid JSON.`,
    };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'malformed', appearances: NONE, reason: `${APPEARANCE_PATH} is not an object.` };
  }
  const appearances = new Map<VaultPath, Appearance>();
  for (const [path, entry] of Object.entries(value)) {
    const appearance = readEntry(entry);
    if (path !== '' && appearance !== null) appearances.set(path, appearance);
  }
  return { kind: 'ok', appearances };
}

/** An entry's string fields; null when it has neither (or is not an object). */
function readEntry(entry: unknown): Appearance | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { color, icon } = entry as Record<string, unknown>;
  return withFields({
    color: typeof color === 'string' ? color : undefined,
    icon: typeof icon === 'string' ? icon : undefined,
  });
}

/** The look with only the fields it has; null when it has none. */
function withFields(fields: { color: string | undefined; icon: string | undefined }) {
  const appearance: { color?: string; icon?: string } = {};
  if (fields.color !== undefined && fields.color !== '') appearance.color = fields.color;
  if (fields.icon !== undefined && fields.icon !== '') appearance.icon = fields.icon;
  return Object.keys(appearance).length === 0 ? null : (appearance as Appearance);
}

/**
 * The file's text: one path per line, sorted, fields in a fixed order, a
 * trailing newline. Same looks, same bytes; one line per path so two Macs'
 * changes to different rows merge in git. Written by hand because a JSON
 * object puts number-like keys (a folder named `2026`) first.
 */
export function serializeAppearances(appearances: Appearances): string {
  if (appearances.size === 0) return '{}\n';
  const lines = [...appearances.keys()].sort().map((path) => {
    const { color, icon } = appearances.get(path) as Appearance;
    const fields = {
      ...(color === undefined ? {} : { color }),
      ...(icon === undefined ? {} : { icon }),
    };
    return `  ${JSON.stringify(path)}: ${JSON.stringify(fields)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** What to change: a string sets the field, null clears it, leaving it out keeps it. */
export interface AppearancePatch {
  readonly color?: string | null;
  readonly icon?: string | null;
}

/** The looks with `path`'s changed; a look left with neither field is dropped. */
export function setAppearance(
  appearances: Appearances,
  path: VaultPath,
  patch: AppearancePatch,
): Appearances {
  const current = appearances.get(path);
  const pick = (next: string | null | undefined, now: string | undefined) =>
    next === undefined ? now : (next ?? undefined);
  const appearance = withFields({
    color: pick(patch.color, current?.color),
    icon: pick(patch.icon, current?.icon),
  });
  const next = new Map(appearances);
  if (appearance === null) next.delete(path);
  else next.set(path, appearance);
  return next;
}

/**
 * The looks after a note or a folder moved: a folder's own look and every
 * look under it go with it. A look already at a moved-to path (left by a
 * note gone from this Mac) gives way to the one that moved there.
 */
export function appearancesAfterMove(appearances: Appearances, move: PathMove): Appearances {
  const moved = new Map<VaultPath, Appearance>();
  const stayed = new Map<VaultPath, Appearance>();
  for (const [path, appearance] of appearances) {
    const to = pathAfterMove(path, move);
    if (to === null) stayed.set(path, appearance);
    else moved.set(to, appearance);
  }
  return new Map([...stayed, ...moved]);
}

/** The looks without a note or folder the app deleted, and without anything under that folder. */
export function appearancesAfterDelete(appearances: Appearances, path: VaultPath): Appearances {
  return new Map([...appearances].filter(([other]) => !isWithin(other, path)));
}

/**
 * The looks without those at or under `within` whose path is gone. Only for
 * what the app itself just removed: a path missing at load may simply not
 * have synced to this Mac yet, and its look must wait for it.
 */
export function pruneAppearances(
  appearances: Appearances,
  { within, exists }: { within: VaultPath; exists: (path: VaultPath) => boolean },
): Appearances {
  return new Map([...appearances].filter(([path]) => !isWithin(path, within) || exists(path)));
}

/** A look as this version draws it: unknown names read as the default. */
export function resolveAppearance(appearance: Appearance): ResolvedAppearance {
  return { hue: resolveHue(appearance.color), icon: resolveIcon(appearance.icon) };
}
