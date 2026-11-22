import {
  BUILT_IN_CALLOUTS,
  FALLBACK_CALLOUT,
  type BuiltInCalloutType,
  type CalloutHue,
  type CalloutIcon,
  type CalloutSettings,
  type CalloutType,
} from './callout-types.ts';

/** Where a callout's look comes from. */
export type CalloutSource = 'built-in' | 'custom' | 'unknown';

/** A callout's kind as it is drawn: its type's look, or the fallback's. */
export interface ResolvedCallout {
  /** The type's own name (`warning` for `[!caution]`), or the kind lowercased when unknown. */
  readonly key: string;
  readonly label: string;
  readonly hue: CalloutHue;
  readonly icon: CalloutIcon;
  readonly source: CalloutSource;
}

/** `decision` → `Decision`: what a header says for a type with no label. */
export function capitalized(name: string): string {
  const lower = name.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function builtInNamed(kind: string): BuiltInCalloutType | null {
  return (
    BUILT_IN_CALLOUTS.find(
      (type) => same(type.name, kind) || type.aliases.some((a) => same(a, kind)),
    ) ?? null
  );
}

/** Whether `name` is a built-in type or one of its aliases, ignoring case. */
export const isBuiltInCalloutName = (name: string): boolean => builtInNamed(name) !== null;

const resolvedFrom = (type: CalloutType, source: CalloutSource): ResolvedCallout => ({
  key: type.name.toLowerCase(),
  label: type.label ?? capitalized(type.name),
  hue: type.hue,
  icon: type.icon,
  source,
});

/**
 * How a callout of `kind` is drawn, ignoring case: a built-in (or its alias)
 * first, so a hand-edited file cannot restyle one, then the vault's own,
 * else the fallback with the kind as its label.
 */
export function resolveCallout(kind: string, settings: CalloutSettings): ResolvedCallout {
  const builtInType = builtInNamed(kind);
  if (builtInType !== null) return resolvedFrom(builtInType, 'built-in');
  const custom = settings.types.find((type) => same(type.name, kind));
  if (custom !== undefined) return resolvedFrom(custom, 'custom');
  return {
    key: kind.toLowerCase(),
    label: capitalized(kind),
    ...FALLBACK_CALLOUT,
    source: 'unknown',
  };
}

/** The types a menu offers: the built-ins not hidden, in Obsidian's order, then the vault's own by name. */
export function offeredCallouts(settings: CalloutSettings): readonly CalloutType[] {
  const hidden = new Set(settings.hidden);
  return [
    ...BUILT_IN_CALLOUTS.filter((type) => !hidden.has(type.name)),
    ...[...settings.types].sort((a, b) => compareNames(a.name, b.name)),
  ];
}

/** Names in a stable order: ignoring case, then by case, so the same list sorts the same way everywhere. */
export function compareNames(a: string, b: string): number {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The name to write when a callout of `current` is changed to `type`: the
 * note's own spelling when it is the same type, so `[!NOTE]` stays
 * `[!NOTE]`; else the type's name as defined.
 */
export function kindAfterChange(
  current: string,
  type: CalloutType,
  settings: CalloutSettings,
): string {
  return resolveCallout(current, settings).key === type.name.toLowerCase() ? current : type.name;
}
