import { isBuiltInCalloutName } from './callout-catalog.ts';
import { CALLOUT_NAME } from './callouts-file.ts';
import {
  isCalloutHue,
  isCalloutIcon,
  type CalloutSettings,
  type CalloutType,
} from './callout-types.ts';

/** A type as the form holds it while it is typed. */
export interface CalloutDraft {
  readonly name: string;
  readonly label: string;
  readonly hue: string;
  readonly icon: string;
}

/** What is wrong with a draft, by field; empty when it can be saved. */
export interface CalloutDraftProblems {
  readonly name?: string;
  readonly label?: string;
  readonly hue?: string;
  readonly icon?: string;
}

export const MAX_CALLOUT_LABEL = 40;

export type CalloutDraftCheck =
  | { readonly kind: 'ok'; readonly type: CalloutType }
  | { readonly kind: 'invalid'; readonly problems: CalloutDraftProblems };

function nameProblem(
  name: string,
  { settings, replacing }: { settings: CalloutSettings; replacing: string | null },
): string | undefined {
  if (name === '') return 'Give the type a name.';
  if (!CALLOUT_NAME.test(name)) {
    return 'Start with a letter, then use only letters, digits, - and _ (no spaces or ]).';
  }
  if (isBuiltInCalloutName(name)) return `“${name}” is a built-in type.`;
  const taken = settings.types.some(
    (type) =>
      type.name.toLowerCase() === name.toLowerCase() &&
      type.name.toLowerCase() !== replacing?.toLowerCase(),
  );
  return taken ? `There is already a type named “${name}”.` : undefined;
}

/**
 * Whether a draft can be saved as a type, beside the vault's others:
 * `replacing` names the type being edited, which its own name may keep.
 * Names are unique ignoring case, as `[!Name]` and `[!name]` are one type.
 */
export function checkCalloutDraft(
  draft: CalloutDraft,
  context: { settings: CalloutSettings; replacing: string | null },
): CalloutDraftCheck {
  const name = draft.name.trim();
  const label = draft.label.trim();
  const problems: CalloutDraftProblems = {
    ...optional('name', nameProblem(name, context)),
    ...optional(
      'label',
      label.length > MAX_CALLOUT_LABEL
        ? `Keep the label to ${MAX_CALLOUT_LABEL} characters.`
        : undefined,
    ),
    ...optional('hue', isCalloutHue(draft.hue) ? undefined : 'Pick a color.'),
    ...optional('icon', isCalloutIcon(draft.icon) ? undefined : 'Pick an icon.'),
  };
  if (Object.keys(problems).length > 0 || !isCalloutHue(draft.hue) || !isCalloutIcon(draft.icon)) {
    return { kind: 'invalid', problems };
  }
  return {
    kind: 'ok',
    type: { name, label: label === '' ? null : label, hue: draft.hue, icon: draft.icon },
  };
}

const optional = <K extends keyof CalloutDraftProblems>(key: K, problem: string | undefined) =>
  problem === undefined ? {} : { [key]: problem };

/** The settings with `type` saved: in place of `replacing` when it names one, else added. */
export function withCalloutType(
  settings: CalloutSettings,
  { type, replacing }: { type: CalloutType; replacing: string | null },
): CalloutSettings {
  const gone = (replacing ?? type.name).toLowerCase();
  return {
    ...settings,
    types: [...settings.types.filter((held) => held.name.toLowerCase() !== gone), type],
  };
}

/** The settings without the type named `name` (ignoring case). */
export function withoutCalloutType(settings: CalloutSettings, name: string): CalloutSettings {
  return {
    ...settings,
    types: settings.types.filter((type) => type.name.toLowerCase() !== name.toLowerCase()),
  };
}

/** The settings with a built-in kept out of the menus, or offered again. */
export function withBuiltInHidden(
  settings: CalloutSettings,
  { name, hidden }: { name: string; hidden: boolean },
): CalloutSettings {
  const key = name.toLowerCase();
  const rest = settings.hidden.filter((held) => held !== key);
  return { ...settings, hidden: hidden ? [...rest, key] : rest };
}

/**
 * Whether a note's text has a callout of `name` (ignoring case): a quote
 * line, at any depth of quote, opening with `[!name]`. For telling the
 * person what a delete leaves behind; it reads the text, never changes it.
 */
export function usesCalloutType(text: string, name: string): boolean {
  const escaped = name.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(`^[ \\t]{0,3}(?:>[ \\t]?)+\\[!${escaped}\\]`, 'im').test(text);
}
