/**
 * Obsidian callouts: a blockquote whose first line is `[!note]`, optionally with
 * a title and a fold marker.
 *
 *     > [!warning] Be careful
 *     > body text
 */
export interface CalloutMarker {
  /** As the note writes it: `NOTE` stays `NOTE`. Types are matched ignoring case. */
  readonly kind: string;
  readonly title: string | null;
  /** `+` or `-` when the callout is foldable; kept so it round-trips. */
  readonly fold: string | null;
}

const MARKER = /^\[!([A-Za-z][\w-]*)\]([+-])?[ \t]*(.*)$/;

export function parseCalloutMarker(line: string): CalloutMarker | null {
  const match = MARKER.exec(line);
  if (match === null) return null;
  const title = (match[3] ?? '').trim();
  return {
    kind: match[1] ?? '',
    title: title === '' ? null : title,
    fold: match[2] ?? null,
  };
}

export function formatCalloutMarker(marker: CalloutMarker): string {
  const fold = marker.fold ?? '';
  const title = marker.title === null ? '' : ` ${marker.title}`;
  return `[!${marker.kind}]${fold}${title}`;
}

/** The label shown when a callout has no title of its own. */
export function calloutLabel(marker: CalloutMarker): string {
  if (marker.title !== null) return marker.title;
  const kind = marker.kind.toLowerCase();
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** A callout's first line as a quote writes it: up to three spaces, `>`, then `[!kind]`. */
const QUOTED_MARKER = /^( {0,3}>[ \t]*)\[!([A-Za-z][\w-]*)\]/;

/** The kind in a callout's `[!kind]` as its markdown writes it, or null when it opens with none. */
export function calloutKindOf(markdown: string): string | null {
  return QUOTED_MARKER.exec(markdown)?.[2] ?? null;
}

/**
 * A callout's markdown with only its type changed: the `kind` in `[!kind]`
 * on its first line, every other byte — title, fold marker, body — as it
 * was. Null when the text does not open with a callout's marker.
 */
export function withCalloutKind(markdown: string, kind: string): string | null {
  const match = QUOTED_MARKER.exec(markdown);
  if (match === null) return null;
  const quote = match[1] ?? '';
  return `${quote}[!${kind}]${markdown.slice(match[0].length)}`;
}
