import { APPEARANCE_HUES, APPEARANCE_ICONS, CALLOUT_ICONS } from '../../application/index.ts';
import type { AppearanceHue, AppearanceIcon } from '../../domain/appearance/index.ts';
import type { CalloutIcon } from '../../domain/callouts/index.ts';
import type { IconName } from '../shell/icons.tsx';

/*
 * What the pickers offer, for every feature that picks a hue or a glyph:
 * a folder's or a note's look (Icon & color…) and a callout type. One hue
 * set and one glyph registry, each named the same wherever it is offered.
 */

/** What the picker calls each hue. */
const HUE_LABELS: Readonly<Record<AppearanceHue, string>> = {
  gray: 'Gray',
  brown: 'Brown',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  red: 'Red',
};

/** What the picker calls each glyph: what it is for, not what it draws. */
const ICON_LABELS: Readonly<Record<AppearanceIcon | CalloutIcon, string>> = {
  pencil: 'Pencil',
  info: 'Info',
  clipboard: 'Clipboard',
  todo: 'To-do',
  lightbulb: 'Light bulb',
  check: 'Check',
  question: 'Question',
  alert: 'Alert',
  close: 'Cross',
  flame: 'Flame',
  bug: 'Bug',
  list: 'List',
  bookmark: 'Bookmark',
  pin: 'Pin',
  doc: 'Page',
  folder: 'Folder',
  star: 'Star',
  heart: 'Heart',
  idea: 'Ideas',
  spark: 'Spark',
  bolt: 'Bolt',
  flag: 'Flag',
  task: 'Checklist',
  calendar: 'Calendar',
  clock: 'Clock',
  inbox: 'Inbox',
  archive: 'Archive',
  book: 'Book',
  school: 'School',
  work: 'Work',
  person: 'Person',
  people: 'People',
  home: 'Home',
  money: 'Money',
  health: 'Health',
  travel: 'Travel',
  globe: 'Globe',
  code: 'Code',
  wrench: 'Tools',
  lock: 'Private',
  camera: 'Photos',
  music: 'Music',
  shopping: 'Shopping',
  chart: 'Chart',
  tag: 'Tag',
  link: 'Link',
  quote: 'Quote',
  cloud: 'Cloud',
  sun: 'Sun',
};

/** The glyph each icon name draws; a name with no glyph of that name fails the typecheck here. */
export function glyphOf(icon: AppearanceIcon | CalloutIcon): IconName {
  return icon satisfies IconName;
}

export const HUE_OPTIONS = APPEARANCE_HUES.map((hue) => ({ value: hue, label: HUE_LABELS[hue] }));

export const ICON_OPTIONS = APPEARANCE_ICONS.map((icon) => ({
  value: icon,
  label: ICON_LABELS[icon],
  icon: glyphOf(icon),
}));

/** The glyphs a callout type may show, with the same names as everywhere else. */
export const CALLOUT_ICON_OPTIONS = CALLOUT_ICONS.map((icon) => ({
  value: icon,
  label: ICON_LABELS[icon],
  icon: glyphOf(icon),
}));
