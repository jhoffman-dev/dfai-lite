import { APP_FOLDER, type VaultPath } from '../vault/index.ts';
import { compareNames, isBuiltInCalloutName } from './callout-catalog.ts';
import {
  FALLBACK_CALLOUT,
  isCalloutHue,
  isCalloutIcon,
  type CalloutSettings,
  type CalloutType,
} from './callout-types.ts';

/** Where the vault's own callout types live: synced like a note, read by Claude. */
export const CALLOUTS_PATH = `${APP_FOLDER}/callouts.json`;

/** A name `[!name]` reads as a callout: a letter, then letters, digits, `-` and `_`. */
export const CALLOUT_NAME = /^[A-Za-z][\w-]*$/;

/**
 * The settings read from the file's text. Text that is not the file's shape
 * — not JSON, not an object, a type without a usable name — reads as no
 * settings and says why: writing over it would lose what it holds, so only
 * the person may (`malformed`). A color or icon this version does not know
 * is drawn with the fallback's.
 */
export type ParsedCalloutSettings =
  | { readonly kind: 'ok'; readonly settings: CalloutSettings }
  | { readonly kind: 'malformed'; readonly settings: CalloutSettings; readonly reason: string };

const malformed = (reason: string): ParsedCalloutSettings => ({
  kind: 'malformed',
  settings: { types: [], hidden: [] },
  reason: `${CALLOUTS_PATH} ${reason}`,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseCalloutSettings(text: string): ParsedCalloutSettings {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // The text is not JSON; that is exactly what `malformed` reports.
    return malformed('is not valid JSON.');
  }
  if (!isRecord(value)) return malformed('is not an object.');
  const { types = [], hidden = [] } = value;
  if (!Array.isArray(types)) return malformed('has a "types" that is not a list.');
  if (!Array.isArray(hidden)) return malformed('has a "hidden" that is not a list.');
  const read: CalloutType[] = [];
  for (const [at, entry] of types.entries()) {
    const type = typeOf(entry);
    if (type === null) return malformed(`has a type (number ${at + 1}) without a usable name.`);
    if (!read.some((other) => other.name.toLowerCase() === type.name.toLowerCase()))
      read.push(type);
  }
  const names = hidden.filter((name): name is string => typeof name === 'string');
  return { kind: 'ok', settings: sortedSettings({ types: read, hidden: names }) };
}

function typeOf(entry: unknown): CalloutType | null {
  if (!isRecord(entry) || typeof entry['name'] !== 'string') return null;
  if (!CALLOUT_NAME.test(entry['name'])) return null;
  const label = typeof entry['label'] === 'string' ? entry['label'].trim() : '';
  return {
    name: entry['name'],
    label: label === '' ? null : label,
    hue: isCalloutHue(entry['color']) ? entry['color'] : FALLBACK_CALLOUT.hue,
    icon: isCalloutIcon(entry['icon']) ? entry['icon'] : FALLBACK_CALLOUT.icon,
  };
}

function sortedSettings({ types, hidden }: CalloutSettings): CalloutSettings {
  return {
    types: [...types].sort((a, b) => compareNames(a.name, b.name)),
    hidden: [...new Set(hidden.map((name) => name.toLowerCase()))]
      .filter(isBuiltInCalloutName)
      .sort(),
  };
}

/**
 * The file's text: types sorted by name, each with its keys in one order
 * (a label only when it has one), and a newline at the end. The same
 * settings always give the same bytes, so a sync sees no change that is not one.
 */
export function serializeCalloutSettings(settings: CalloutSettings): string {
  const { types, hidden } = sortedSettings(settings);
  const file = {
    hidden,
    types: types.map(({ name, label, hue, icon }) => ({
      name,
      ...(label === null ? {} : { label }),
      color: hue,
      icon,
    })),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

const CONFLICT_COPY = /^\.dfai-lite\/callouts \(conflict[^/]*\)(?: \d+)?\.json$/;

/**
 * Whether `path` is the other Mac's version of the file, saved beside it by a
 * sync both Macs changed it in (`callouts (conflict from Mac).json`).
 */
export const isCalloutsConflictCopy = (path: VaultPath): boolean => CONFLICT_COPY.test(path);

/**
 * The settings with the types only a conflict copy holds added: both Macs
 * added types, and neither Mac's are lost. Where both have a type of one
 * name, this Mac's (`primary`) stands; the hidden list is this Mac's.
 */
export function mergeCalloutSettings(
  primary: CalloutSettings,
  copies: readonly CalloutSettings[],
): CalloutSettings {
  const types = [...primary.types];
  for (const copy of copies) {
    for (const type of copy.types) {
      if (!types.some((held) => held.name.toLowerCase() === type.name.toLowerCase()))
        types.push(type);
    }
  }
  return sortedSettings({ types, hidden: primary.hidden });
}
