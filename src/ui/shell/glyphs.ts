/*
 * The app's glyphs, DFAI's (packages/ui/src/icon.tsx), as data: each a few
 * shapes on a 24-unit grid, stroked in `currentColor` 1.8 wide, so they take
 * the color of the text around them and nothing is fetched. As data, one set
 * draws both in React (`Icon`) and in the editor's own DOM (a callout's
 * badge, `glyphElement`). `keyboard`, `code`, `menu`, `folder-plus` and the
 * callouts' glyphs from `pencil` on are Lite's own, drawn in the same stroke.
 */

/** How a shape is drawn: a plain line, round ends, round joins, both, or filled. */
type Stroke = 'line' | 'round' | 'joined' | 'both' | 'fill';

export interface GlyphShape {
  readonly tag: 'path' | 'circle' | 'rect';
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly stroke: Stroke;
  /** A stroke width other than 1.8. */
  readonly width?: number;
}

const path = (d: string, stroke: Stroke = 'joined', width?: number): GlyphShape => ({
  tag: 'path',
  attrs: { d },
  stroke,
  ...(width === undefined ? {} : { width }),
});
const circle = (cx: number, cy: number, r: number, stroke: Stroke = 'line'): GlyphShape => ({
  tag: 'circle',
  attrs: { cx, cy, r },
  stroke,
});
const rect = (x: number, y: number, width: number, height: number, rx: number): GlyphShape => ({
  tag: 'rect',
  attrs: { x, y, width, height, rx },
  stroke: 'line',
});
/** A dot: the point of an `i`, a `?` or a `!`. */
const dot = (cx: number, cy: number) => circle(cx, cy, 1.1, 'fill');

const FOLDER =
  'M3.5 7.5A2 2 0 0 1 5.5 5.5h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z';

/** The glyphs of the app's chrome. */
const CHROME = {
  search: [circle(11, 11, 6.5), path('M16 16l4.5 4.5', 'round')],
  moon: [path('M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z')],
  plus: [path('M12 5v14M5 12h14', 'round', 1.9)],
  folder: [path(FOLDER)],
  'folder-plus': [path(FOLDER), path('M12 11v5M9.5 13.5h5', 'round')],
  // DFAI's `panel`: the sidebar's show/hide.
  sidebar: [rect(3.5, 4.5, 17, 15, 3), path('M9.5 4.5v15', 'line')],
  chevron: [path('M7 9.5l5 5 5-5', 'both', 2)],
  split: [rect(3.5, 4.5, 17, 15, 3), path('M12 4.5v15', 'line')],
  more: [circle(5.5, 12, 1.7, 'fill'), circle(12, 12, 1.7, 'fill'), circle(18.5, 12, 1.7, 'fill')],
  graph: [
    circle(6, 7, 2.4),
    circle(18, 6, 2.4),
    circle(12, 18, 2.6),
    path('M8.3 7.9l8-1.2M7.2 9.1l3.7 6.7M16.9 8.2l-3.7 7.4', 'round'),
  ],
  // Lite's own: a root on the left, three branches curving out to the right.
  'mind-map': [
    circle(5.5, 12, 2.4),
    circle(18.5, 5.5, 2),
    circle(18.5, 12, 2),
    circle(18.5, 18.5, 2),
    path('M7.9 12h8.6M7.6 10.8C11 6 12.5 5.5 16.5 5.5M7.6 13.2C11 18 12.5 18.5 16.5 18.5', 'round'),
  ],
  // Lite's own: a crosshair, what Focus centers the map on.
  target: [
    circle(12, 12, 6.5),
    circle(12, 12, 1.6, 'fill'),
    path('M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3', 'round'),
  ],
  // Lite's own: four corners, the whole map fitted to the view.
  fit: [
    path(
      'M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15',
      'both',
    ),
  ],
  keyboard: [
    rect(3, 6, 18, 12, 2.5),
    path('M7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M8 14h8', 'round'),
  ],
  'arrow-left': [path('M19 12H5.5M11 6l-6 6 6 6', 'both', 1.9)],
  'arrow-right': [path('M5 12h13.5M13 6l6 6-6 6', 'both', 1.9)],
  menu: [path('M4 7h16M4 12h16M4 17h16', 'round')],
  gear: [
    circle(12, 12, 3.2),
    path(
      'M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8',
      'round',
    ),
  ],
} satisfies Record<string, readonly GlyphShape[]>;

/** The glyphs a callout may show; the chrome's own among them are drawn once, here. */
/** Glyphs callouts brought: the badges of the built-in types and a few more. */
const CALLOUT_GLYPHS = {
  sun: [
    circle(12, 12, 4),
    path(
      'M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6',
      'round',
    ),
  ],
  cloud: [
    path('M7.5 18.5h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.6a4.5 4.5 0 0 0 .5 8.9z', 'both'),
  ],
  doc: [
    path(
      'M7 3.5h6.8l4.7 4.7v11.3a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5v-14.5A1.5 1.5 0 0 1 7 3.5zM13.5 3.5v5h5',
    ),
  ],
  close: [path('M6.5 6.5l11 11M17.5 6.5l-11 11', 'round', 1.9)],
  star: [path('M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z')],
  tag: [
    path('M3.5 4.5v7.2l8.8 8.8 8.2-8.2-8.8-8.8H4.5a1 1 0 0 0-1 1z'),
    circle(8.2, 8.2, 1.4, 'fill'),
  ],
  code: [path('M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5', 'both')],
  pencil: [
    path('M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5z'),
    path('M13.8 7l3.2 3.2', 'round'),
  ],
  info: [circle(12, 12, 8.5), path('M12 11v5.5', 'round'), dot(12, 7.8)],
  clipboard: [
    rect(6, 5, 12, 15.5, 2),
    path('M9.5 5V3.8h5V5', 'joined'),
    path('M9 11h6M9 14.5h6', 'round'),
  ],
  todo: [rect(4.5, 4.5, 15, 15, 3), path('M8.5 12.2l2.4 2.4 4.6-5', 'both')],
  lightbulb: [
    path('M12 3.5a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-.6c0-.8.4-1.5 1-2A6 6 0 0 0 12 3.5z'),
    path('M10 20.5h4', 'round'),
  ],
  check: [path('M5 12.5l4.5 4.5L19 7.5', 'both', 2)],
  question: [
    circle(12, 12, 8.5),
    path('M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.4', 'round'),
    dot(12, 16.8),
  ],
  alert: [path('M12 4l9 15.5H3z'), path('M12 10v4', 'round'), dot(12, 16.9)],
  flame: [
    path(
      'M12 3.5c.5 3-3.5 4.8-3.5 9a3.5 3.5 0 0 0 7 0c0-1.2-.5-2.2-1-3 2 .8 4 3 4 5.5a6.5 6.5 0 0 1-13 0c0-5 5.5-7 6.5-11.5z',
    ),
  ],
  bug: [
    rect(8, 8, 8, 11, 4),
    path(
      'M9.5 8a2.5 2.5 0 0 1 5 0M4.5 10.5l3.5 1.5M19.5 10.5L16 12M4.5 17l3.5-1.5M19.5 17L16 15.5M12 11v8',
      'round',
    ),
  ],
  list: [path('M9 7h11M9 12h11M9 17h11', 'round'), dot(4.8, 7), dot(4.8, 12), dot(4.8, 17)],
  bookmark: [path('M7 3.5h10a1 1 0 0 1 1 1v16l-6-4-6 4v-16a1 1 0 0 1 1-1z')],
  pin: [path('M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z'), circle(12, 10, 2.3)],
} satisfies Record<string, readonly GlyphShape[]>;

/**
 * The glyphs a folder or a note can wear (Icon & color…), callouts too.
 * `calendar`, `inbox`, `chart`, `task`, `person`, `book`, `archive`, `link`,
 * `bolt`, `health` (DFAI's pulse), `spark`, `clock` and `quote` are DFAI's
 * (packages/ui/src/icon.tsx); the others are Lite's own.
 */
const ROW_GLYPHS = {
  heart: [
    path(
      'M12 19.8s-7.5-4.5-7.5-10.1A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.4c0 5.6-7.5 10.1-7.5 10.1z',
    ),
  ],
  idea: [
    path('M9.3 17v-1.4c0-.9-.5-1.6-1.2-2.2a5.8 5.8 0 1 1 7.8 0c-.7.6-1.2 1.3-1.2 2.2V17z'),
    path('M10 20.5h4', 'round'),
  ],
  spark: [
    path(
      'M12 3.5c.6 4.4 2.9 6.9 8 8.5-5.1 1.6-7.4 4.1-8 8.5-.6-4.4-2.9-6.9-8-8.5 5.1-1.6 7.4-4.1 8-8.5z',
    ),
  ],
  bolt: [path('M13 3L5 13.5h6L10 21l8-10.5h-6z')],
  flag: [path('M5.5 21V4M5.5 4.5h11.5l-2.6 4.2 2.6 4.3H5.5', 'both')],
  task: [rect(4, 4, 16, 16, 4.5), path('M8.5 12.3l2.4 2.4 4.8-5.1', 'both', 1.9)],
  calendar: [rect(3.5, 5, 17, 15.5, 3), path('M3.5 10h17M8 3v4M16 3v4', 'round')],
  clock: [circle(12, 12, 8), path('M12 8v4.3l2.8 1.8', 'round')],
  inbox: [
    path(
      'M3.5 13.5L6.2 5.5h11.6l2.7 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z M3.5 13.5h5l1.5 2.2h4l1.5-2.2h5',
    ),
  ],
  archive: [
    { ...rect(3.5, 4.5, 17, 4.5, 1.5), stroke: 'joined' },
    path('M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9'),
    path('M10 13h4', 'round'),
  ],
  book: [
    path(
      'M12 6.5c-1.8-1.3-4.3-2-7-2v13c2.7 0 5.2.7 7 2 1.8-1.3 4.3-2 7-2v-13c-2.7 0-5.2.7-7 2zM12 6.5v13',
    ),
  ],
  school: [
    path('M2.5 9.5L12 5l9.5 4.5L12 14z'),
    path('M6.5 11.6v4.2c1.5 1.4 3.4 2.2 5.5 2.2s4-.8 5.5-2.2v-4.2M21.5 9.5v5', 'round'),
  ],
  work: [
    rect(3.5, 7.5, 17, 12, 2.5),
    path('M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17', 'round'),
  ],
  person: [circle(12, 8.5, 3.8), path('M4.8 20c1.3-3.6 4-5.4 7.2-5.4s5.9 1.8 7.2 5.4', 'round')],
  people: [
    circle(9, 8.5, 3.3),
    path('M3 19.5c1-3.2 3.3-4.8 6-4.8s5 1.6 6 4.8', 'round'),
    path('M15.5 5.6a3.3 3.3 0 0 1 0 6.1M17.5 14.9c1.6.6 2.8 2.1 3.5 4.6', 'round'),
  ],
  home: [path('M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-5v6h-4A1.5 1.5 0 0 1 4 19z')],
  money: [
    rect(3, 6.5, 18, 11, 2.5),
    circle(12, 12, 2.6),
    path('M6.5 9.5v.01M17.5 14.5v.01', 'round', 2.4),
  ],
  health: [path('M3 12h4l2.5-6 5 12 2.5-6h4', 'both')],
  travel: [
    path(
      'M12 3c.8 0 1.4.8 1.4 1.8v4.7l6.6 4v2l-6.6-2v4l2 1.5v1.5L12 19.5l-3.4 1V19l2-1.5v-4l-6.6 2v-2l6.6-4V4.8C10.6 3.8 11.2 3 12 3z',
    ),
  ],
  globe: [
    circle(12, 12, 8.5),
    path(
      'M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5s1.2-6.2 3.5-8.5z',
    ),
  ],
  wrench: [
    path(
      'M14.6 4.2a4.6 4.6 0 0 0-5.4 6L4.1 15.3a2 2 0 0 0 2.8 2.8L12 13a4.6 4.6 0 0 0 6-5.4l-2.7 2.7-2.6-.7-.7-2.6z',
    ),
  ],
  lock: [rect(5, 10.5, 14, 10, 2.5), path('M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2', 'round')],
  camera: [
    path('M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'),
    circle(12, 13, 3.5),
  ],
  music: [path('M9 18V5.5l10-2V16', 'both'), circle(6.5, 18, 2.5), circle(16.5, 16, 2.5)],
  shopping: [
    path('M5 8h14l-1 11.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.5z'),
    path('M9 10.5V7a3 3 0 0 1 6 0v3.5', 'round'),
  ],
  chart: [path('M5 19.5V11M10.3 19.5V5M15.6 19.5v-6.5M20.5 19.5V8.5', 'round', 2.2)],
  link: [
    path(
      'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
      'round',
    ),
  ],
  quote: [
    path('M5 16.5c2.5 0 4-1.6 4-4.2V7.5H4.5v5H8'),
    path('M15 16.5c2.5 0 4-1.6 4-4.2V7.5h-4.5v5H18'),
  ],
} satisfies Record<string, readonly GlyphShape[]>;

/** Every glyph, by the name stored for it in `appearance.json` and `callouts.json`. */
export const GLYPHS = { ...CHROME, ...CALLOUT_GLYPHS, ...ROW_GLYPHS } as const;

export type IconName = keyof typeof GLYPHS;

/** A shape's paint, as SVG attributes named the way React names them. */
export function paintOf(shape: GlyphShape): Readonly<Record<string, string | number>> {
  if (shape.stroke === 'fill') return { fill: 'currentColor' };
  const width = shape.width ?? 1.8;
  const ends =
    shape.stroke === 'round' || shape.stroke === 'both' ? { strokeLinecap: 'round' } : {};
  const joins =
    shape.stroke === 'joined' || shape.stroke === 'both' ? { strokeLinejoin: 'round' } : {};
  return { fill: 'none', stroke: 'currentColor', strokeWidth: width, ...ends, ...joins };
}

const SVG = 'http://www.w3.org/2000/svg';
const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** A glyph as an SVG element of the page's own, for DOM drawn outside React (the editor's). */
export function glyphElement(name: IconName, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [key, value] of Object.entries({
    class: 'icon',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false',
  })) {
    svg.setAttribute(key, String(value));
  }
  for (const shape of GLYPHS[name]) {
    const element = document.createElementNS(SVG, shape.tag);
    for (const [key, value] of Object.entries({ ...shape.attrs, ...paintOf(shape) })) {
      element.setAttribute(kebab(key), String(value));
    }
    svg.appendChild(element);
  }
  return svg;
}
