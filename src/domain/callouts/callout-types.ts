import { APPEARANCE_HUES } from '../appearance/index.ts';

/**
 * The kinds of callout a note can hold: `> [!warning] Title`. The app comes
 * with Obsidian's set; the person adds their own, kept in the vault so the
 * other Mac and Claude read the same list. A type is only how a callout is
 * drawn and offered: the note holds its name and nothing else, so a type
 * that is unknown here (deleted, or made in another app) still round-trips.
 */

/**
 * The hues a callout is drawn in: DFAI's pastel set, each with a light and a
 * dark pair — the same set a folder or a note is colored from.
 */
export const CALLOUT_HUES = APPEARANCE_HUES;

export type CalloutHue = (typeof CALLOUT_HUES)[number];

/** The glyphs a callout's badge may show, by name; the UI draws them. */
export const CALLOUT_ICONS = [
  'pencil',
  'info',
  'clipboard',
  'todo',
  'lightbulb',
  'check',
  'question',
  'alert',
  'close',
  'flame',
  'bug',
  'list',
  'quote',
  'star',
  'flag',
  'bookmark',
  'heart',
  'book',
  'calendar',
  'clock',
  'person',
  'link',
  'lock',
  'pin',
  'tag',
  'doc',
  'code',
  'cloud',
  'sun',
  // The sidebar's glyphs too (Icon & color…), so both pick from one set.
  'folder',
  'spark',
  'bolt',
  'inbox',
  'archive',
  'school',
  'work',
  'people',
  'home',
  'money',
  'health',
  'travel',
  'globe',
  'wrench',
  'camera',
  'music',
  'shopping',
  'chart',
] as const;

export type CalloutIcon = (typeof CALLOUT_ICONS)[number];

/** One kind of callout: the name written in `[!name]`, and how it is drawn. */
export interface CalloutType {
  /** As written in `[!name]`; matched ignoring case. */
  readonly name: string;
  /** What its header says when the callout has no title; null: the name, capitalized. */
  readonly label: string | null;
  readonly hue: CalloutHue;
  readonly icon: CalloutIcon;
}

/** A type the app comes with, and the other names Obsidian reads as it. */
export interface BuiltInCalloutType extends CalloutType {
  readonly aliases: readonly string[];
}

const builtIn = (
  name: string,
  label: string,
  { hue, icon, aliases = [] }: { hue: CalloutHue; icon: CalloutIcon; aliases?: string[] },
): BuiltInCalloutType => ({ name, label, hue, icon, aliases });

/** Obsidian's types, in its order, with their aliases. */
export const BUILT_IN_CALLOUTS: readonly BuiltInCalloutType[] = [
  builtIn('note', 'Note', { hue: 'blue', icon: 'pencil' }),
  builtIn('abstract', 'Abstract', {
    hue: 'purple',
    icon: 'clipboard',
    aliases: ['summary', 'tldr'],
  }),
  builtIn('info', 'Info', { hue: 'blue', icon: 'info' }),
  builtIn('todo', 'Todo', { hue: 'blue', icon: 'todo' }),
  builtIn('tip', 'Tip', { hue: 'green', icon: 'lightbulb', aliases: ['hint', 'important'] }),
  builtIn('success', 'Success', { hue: 'green', icon: 'check', aliases: ['check', 'done'] }),
  builtIn('question', 'Question', { hue: 'yellow', icon: 'question', aliases: ['help', 'faq'] }),
  builtIn('warning', 'Warning', {
    hue: 'orange',
    icon: 'alert',
    aliases: ['caution', 'attention'],
  }),
  builtIn('failure', 'Failure', { hue: 'red', icon: 'close', aliases: ['fail', 'missing'] }),
  builtIn('danger', 'Danger', { hue: 'red', icon: 'flame', aliases: ['error'] }),
  builtIn('bug', 'Bug', { hue: 'red', icon: 'bug' }),
  builtIn('example', 'Example', { hue: 'purple', icon: 'list' }),
  builtIn('quote', 'Quote', { hue: 'gray', icon: 'quote', aliases: ['cite'] }),
];

/** How a callout of a type nobody defines is drawn: quiet, so it reads as "not one of mine". */
export const FALLBACK_CALLOUT: Pick<CalloutType, 'hue' | 'icon'> = { hue: 'gray', icon: 'info' };

/** The callouts a vault offers beyond the built-ins, and the built-ins it keeps out of menus. */
export interface CalloutSettings {
  readonly types: readonly CalloutType[];
  /** Built-in names (lowercase) not offered in menus; a note using one still shows it. */
  readonly hidden: readonly string[];
}

export const NO_CALLOUT_SETTINGS: CalloutSettings = { types: [], hidden: [] };

export const isCalloutHue = (value: unknown): value is CalloutHue =>
  typeof value === 'string' && (CALLOUT_HUES as readonly string[]).includes(value);

export const isCalloutIcon = (value: unknown): value is CalloutIcon =>
  typeof value === 'string' && (CALLOUT_ICONS as readonly string[]).includes(value);
