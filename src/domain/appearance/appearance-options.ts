/**
 * The colors and icons a folder or a note can wear. Each is a name, kept as
 * written in the file: a name this version does not know (one a newer app on
 * the other Mac wrote) is kept, and simply drawn as the default.
 */

/** The theme's nine pastel hues, the ones tags and pills are drawn in. */
export const APPEARANCE_HUES = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;

export type AppearanceHue = (typeof APPEARANCE_HUES)[number];

/** The glyphs a row can show in place of its folder or page glyph. */
export const APPEARANCE_ICONS = [
  'doc',
  'folder',
  'star',
  'heart',
  'idea',
  'spark',
  'bolt',
  'flag',
  'task',
  'calendar',
  'clock',
  'inbox',
  'archive',
  'book',
  'school',
  'work',
  'person',
  'people',
  'home',
  'money',
  'health',
  'travel',
  'globe',
  'code',
  'wrench',
  'lock',
  'camera',
  'music',
  'shopping',
  'chart',
  'tag',
  'link',
  'quote',
  'cloud',
  'sun',
  'moon',
] as const;

export type AppearanceIcon = (typeof APPEARANCE_ICONS)[number];

/** What a row shows in place of its own glyph: one of the set, or a typed emoji. */
export type ResolvedIcon =
  | { readonly kind: 'glyph'; readonly name: AppearanceIcon }
  | { readonly kind: 'emoji'; readonly text: string };

export function isAppearanceHue(value: string): value is AppearanceHue {
  return (APPEARANCE_HUES as readonly string[]).includes(value);
}

export function isAppearanceIcon(value: string): value is AppearanceIcon {
  return (APPEARANCE_ICONS as readonly string[]).includes(value);
}

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** One emoji, as a person sees one: a single grapheme that is a pictograph (👍🏽, 🇳🇿, 👩‍💻 count). */
export function isSingleEmoji(value: string): boolean {
  const parts = [...graphemes.segment(value)];
  return parts.length === 1 && PICTOGRAPH.test(value);
}

/** The icon a stored name draws as; null for none, or for a name this version does not know. */
export function resolveIcon(value: string | undefined): ResolvedIcon | null {
  if (value === undefined) return null;
  if (isAppearanceIcon(value)) return { kind: 'glyph', name: value };
  if (isSingleEmoji(value)) return { kind: 'emoji', text: value };
  return null;
}

/** The hue a stored name draws as; null for none, or for a name this version does not know. */
export function resolveHue(value: string | undefined): AppearanceHue | null {
  return value !== undefined && isAppearanceHue(value) ? value : null;
}
