import { memo } from 'react';

/*
 * The app's glyphs, DFAI's (packages/ui/src/icon.tsx): drawn inline on a
 * 24-unit grid in `currentColor`, so each takes the color of the text around
 * it, and nothing is fetched. Decorative: the control carries the label.
 * `keyboard`, `code`, `menu` and `folder-plus` are Lite's own, drawn in the same stroke.
 */

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const;
const round = { ...line, strokeLinecap: 'round' } as const;
const joined = { ...line, strokeLinejoin: 'round' } as const;

const GLYPHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" {...line} />
      <path d="M16 16l4.5 4.5" {...round} />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" {...line} />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"
        {...round}
      />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" {...joined} />,
  plus: <path d="M12 5v14M5 12h14" {...round} strokeWidth={1.9} />,
  folder: (
    <path
      d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"
      {...joined}
    />
  ),
  'folder-plus': (
    <>
      <path
        d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"
        {...joined}
      />
      <path d="M12 11v5M9.5 13.5h5" {...round} />
    </>
  ),
  // DFAI's `panel`: the sidebar's show/hide.
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" {...line} />
      <path d="M9.5 4.5v15" {...line} />
    </>
  ),
  cloud: (
    <path
      d="M7.5 18.5h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.6a4.5 4.5 0 0 0 .5 8.9z"
      {...round}
      {...joined}
    />
  ),
  doc: (
    <path
      d="M7 3.5h6.8l4.7 4.7v11.3a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5v-14.5A1.5 1.5 0 0 1 7 3.5zM13.5 3.5v5h5"
      {...joined}
    />
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" {...line} />
      <path
        d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"
        {...round}
      />
    </>
  ),
  chevron: <path d="M7 9.5l5 5 5-5" {...round} {...joined} strokeWidth={2} />,
  split: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" {...line} />
      <path d="M12 4.5v15" {...line} />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...round} strokeWidth={1.9} />,
  star: (
    <path
      d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
      {...joined}
    />
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.7" fill="currentColor" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="7" r="2.4" {...line} />
      <circle cx="18" cy="6" r="2.4" {...line} />
      <circle cx="12" cy="18" r="2.6" {...line} />
      <path d="M8.3 7.9l8-1.2M7.2 9.1l3.7 6.7M16.9 8.2l-3.7 7.4" {...round} />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 4.5v7.2l8.8 8.8 8.2-8.2-8.8-8.8H4.5a1 1 0 0 0-1 1z" {...joined} />
      <circle cx="8.2" cy="8.2" r="1.4" fill="currentColor" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.5" {...line} />
      <path d="M7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M8 14h8" {...round} />
    </>
  ),
  'arrow-left': <path d="M19 12H5.5M11 6l-6 6 6 6" {...round} {...joined} strokeWidth={1.9} />,
  'arrow-right': <path d="M5 12h13.5M13 6l6 6-6 6" {...round} {...joined} strokeWidth={1.9} />,
  code: <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" {...round} {...joined} />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" {...round} />,
} as const;

export type IconName = keyof typeof GLYPHS;

/**
 * One glyph, 17px unless asked otherwise, as DFAI's. `filled` fills the
 * outline in its own color: a star that is on.
 */
export const Icon = memo(function Icon({
  name,
  size = 17,
  filled = false,
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg
      className={filled ? 'icon icon--filled' : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
});
