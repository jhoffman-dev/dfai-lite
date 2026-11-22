import { APPEARANCE_HUES, APPEARANCE_ICONS } from '../../application/index.ts';
import type { AppearanceHue, AppearanceIcon } from '../../domain/appearance/index.ts';
import type { IconName } from '../shell/icons.tsx';

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
const ICON_LABELS: Readonly<Record<AppearanceIcon, string>> = {
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
export function glyphOf(icon: AppearanceIcon): IconName {
  return icon satisfies IconName;
}

export const HUE_OPTIONS = APPEARANCE_HUES.map((hue) => ({ value: hue, label: HUE_LABELS[hue] }));

export const ICON_OPTIONS = APPEARANCE_ICONS.map((icon) => ({
  value: icon,
  label: ICON_LABELS[icon],
  icon: glyphOf(icon),
}));
