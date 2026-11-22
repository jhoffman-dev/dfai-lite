import { joined, line, round } from './icon-strokes.ts';

/*
 * The glyphs a folder or a note can wear (Icon & color…), in the same stroke
 * as the rest. `calendar`, `inbox`, `chart`, `task`, `person`, `book`,
 * `archive`, `link`, `bolt`, `health` (DFAI's pulse), `spark`, `clock` and
 * `quote` are DFAI's (packages/ui/src/icon.tsx); the others are Lite's own.
 */
export const MORE_GLYPHS = {
  heart: (
    <path
      d="M12 19.8s-7.5-4.5-7.5-10.1A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.4c0 5.6-7.5 10.1-7.5 10.1z"
      {...joined}
    />
  ),
  idea: (
    <>
      <path
        d="M9.3 17v-1.4c0-.9-.5-1.6-1.2-2.2a5.8 5.8 0 1 1 7.8 0c-.7.6-1.2 1.3-1.2 2.2V17z"
        {...joined}
      />
      <path d="M10 20.5h4" {...round} />
    </>
  ),
  spark: (
    <path
      d="M12 3.5c.6 4.4 2.9 6.9 8 8.5-5.1 1.6-7.4 4.1-8 8.5-.6-4.4-2.9-6.9-8-8.5 5.1-1.6 7.4-4.1 8-8.5z"
      {...joined}
    />
  ),
  bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" {...joined} />,
  flag: <path d="M5.5 21V4M5.5 4.5h11.5l-2.6 4.2 2.6 4.3H5.5" {...round} {...joined} />,
  task: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4.5" {...line} />
      <path d="M8.5 12.3l2.4 2.4 4.8-5.1" {...round} {...joined} strokeWidth={1.9} />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" {...line} />
      <path d="M3.5 10h17M8 3v4M16 3v4" {...round} />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" {...line} />
      <path d="M12 8v4.3l2.8 1.8" {...round} />
    </>
  ),
  inbox: (
    <path
      d="M3.5 13.5L6.2 5.5h11.6l2.7 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z M3.5 13.5h5l1.5 2.2h4l1.5-2.2h5"
      {...joined}
    />
  ),
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5" {...joined} />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" {...joined} />
      <path d="M10 13h4" {...round} />
    </>
  ),
  book: (
    <path
      d="M12 6.5c-1.8-1.3-4.3-2-7-2v13c2.7 0 5.2.7 7 2 1.8-1.3 4.3-2 7-2v-13c-2.7 0-5.2.7-7 2zM12 6.5v13"
      {...joined}
    />
  ),
  school: (
    <>
      <path d="M2.5 9.5L12 5l9.5 4.5L12 14z" {...joined} />
      <path d="M6.5 11.6v4.2c1.5 1.4 3.4 2.2 5.5 2.2s4-.8 5.5-2.2v-4.2M21.5 9.5v5" {...round} />
    </>
  ),
  work: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" {...line} />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17" {...round} />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8.5" r="3.8" {...line} />
      <path d="M4.8 20c1.3-3.6 4-5.4 7.2-5.4s5.9 1.8 7.2 5.4" {...round} />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.3" {...line} />
      <path d="M3 19.5c1-3.2 3.3-4.8 6-4.8s5 1.6 6 4.8" {...round} />
      <path d="M15.5 5.6a3.3 3.3 0 0 1 0 6.1M17.5 14.9c1.6.6 2.8 2.1 3.5 4.6" {...round} />
    </>
  ),
  home: (
    <path
      d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-5v6h-4A1.5 1.5 0 0 1 4 19z"
      {...joined}
    />
  ),
  money: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2.5" {...line} />
      <circle cx="12" cy="12" r="2.6" {...line} />
      <path d="M6.5 9.5v.01M17.5 14.5v.01" {...round} strokeWidth={2.4} />
    </>
  ),
  health: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" {...round} {...joined} />,
  travel: (
    <path
      d="M12 3c.8 0 1.4.8 1.4 1.8v4.7l6.6 4v2l-6.6-2v4l2 1.5v1.5L12 19.5l-3.4 1V19l2-1.5v-4l-6.6 2v-2l6.6-4V4.8C10.6 3.8 11.2 3 12 3z"
      {...joined}
    />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" {...line} />
      <path
        d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5s1.2-6.2 3.5-8.5z"
        {...joined}
      />
    </>
  ),
  wrench: (
    <path
      d="M14.6 4.2a4.6 4.6 0 0 0-5.4 6L4.1 15.3a2 2 0 0 0 2.8 2.8L12 13a4.6 4.6 0 0 0 6-5.4l-2.7 2.7-2.6-.7-.7-2.6z"
      {...joined}
    />
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" {...line} />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" {...round} />
    </>
  ),
  camera: (
    <>
      <path
        d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"
        {...joined}
      />
      <circle cx="12" cy="13" r="3.5" {...line} />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5.5l10-2V16" {...round} {...joined} />
      <circle cx="6.5" cy="18" r="2.5" {...line} />
      <circle cx="16.5" cy="16" r="2.5" {...line} />
    </>
  ),
  shopping: (
    <>
      <path d="M5 8h14l-1 11.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.5z" {...joined} />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" {...round} />
    </>
  ),
  chart: (
    <path d="M5 19.5V11M10.3 19.5V5M15.6 19.5v-6.5M20.5 19.5V8.5" {...round} strokeWidth={2.2} />
  ),
  link: (
    <path
      d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
      {...round}
    />
  ),
  quote: (
    <>
      <path d="M5 16.5c2.5 0 4-1.6 4-4.2V7.5H4.5v5H8" {...joined} />
      <path d="M15 16.5c2.5 0 4-1.6 4-4.2V7.5h-4.5v5H18" {...joined} />
    </>
  ),
} as const;
