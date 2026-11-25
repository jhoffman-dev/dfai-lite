// The search command's arguments, read into a request. Pure apart from the
// local calendar, which `--since 2026-11-01` is read in.
import type { SearchFilters } from '../../src/domain/note-search/index.ts';

/** Notes shown when `--limit` is not given, and the most it may ask for. */
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 200;
const DAY_MS = 86_400_000;

export const USAGE = `Usage: node .dfai-lite/search.mjs [words or '"exact phrase"'] [options]
Searches the vault's notes, best first: name hits, then headings, then body; newer first on ties.
  --tag <tag>          only notes with this tag or one under it (repeat for more)
  --folder <folder>    only notes in this folder, at any depth
  --since <date|Nd>    only notes whose file changed on or after a date (2026-11-01) or N days ago (7d)
  --links-to <note>    only notes linking to this note (backlinks), by name or path
  --title              match note names only, print paths only
  --transcripts        also search Transcripts/ (verbatim quotes)
  --limit <n>          notes shown (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT})
  --vault <folder>     the vault (default: the folder holding .dfai-lite/, else this one)
Skips _index/, .dfai-lite/, attachments/, .git/ and, by default, Transcripts/.`;

/** What a run was asked for. */
export interface SearchArgs {
  readonly query: string;
  readonly filters: SearchFilters;
  readonly limit: number;
  readonly vault?: string;
}

export type ParsedArgs =
  | { readonly kind: 'search'; readonly args: SearchArgs }
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string };

const VALUE_FLAGS = new Set(['--tag', '--folder', '--since', '--links-to', '--limit', '--vault']);
const SWITCHES = new Set(['--title', '--transcripts']);

/** Reads the command line; `nowMs` is what `--since 7d` counts back from. */
export function parseSearchArgs(argv: readonly string[], nowMs: number): ParsedArgs {
  const words: string[] = [];
  const values = new Map<string, string[]>();
  const switches = new Set<string>();
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? '';
    if (arg === '--help' || arg === '-h') return { kind: 'help' };
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }
    const [flag = '', inline] = arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg];
    if (SWITCHES.has(flag) && inline === undefined) switches.add(flag);
    else if (VALUE_FLAGS.has(flag)) {
      const value = inline ?? argv[(at += 1)];
      if (value === undefined) return { kind: 'error', message: `${flag} needs a value.` };
      values.set(flag, [...(values.get(flag) ?? []), value]);
    } else return { kind: 'error', message: `Unknown option: ${arg}` };
  }
  return searchArgs({ query: words.join(' '), values, switches, nowMs });
}

function searchArgs(read: {
  query: string;
  values: ReadonlyMap<string, readonly string[]>;
  switches: ReadonlySet<string>;
  nowMs: number;
}): ParsedArgs {
  const last = (flag: string): string | undefined => read.values.get(flag)?.at(-1);
  const limit = last('--limit') === undefined ? DEFAULT_LIMIT : Number(last('--limit'));
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { kind: 'error', message: `--limit must be a whole number from 1 to ${MAX_LIMIT}.` };
  }
  const since = last('--since');
  const modifiedSinceMs = since === undefined ? undefined : sinceMs(since, read.nowMs);
  if (modifiedSinceMs === null) {
    return {
      kind: 'error',
      message: `--since takes a date (2026-11-01) or a number of days (7d), not "${since}".`,
    };
  }
  const filters: SearchFilters = {
    tags: read.values.get('--tag') ?? [],
    folder: last('--folder'),
    modifiedSinceMs,
    linksTo: last('--links-to'),
    titleOnly: read.switches.has('--title'),
    transcripts: read.switches.has('--transcripts'),
  };
  const vault = last('--vault');
  return {
    kind: 'search',
    args: { query: read.query, filters, limit, ...(vault === undefined ? {} : { vault }) },
  };
}

/** The start of a local day (`2026-11-01`), or `N` days before now (`7d`); null for anything else. */
export function sinceMs(value: string, nowMs: number): number | null {
  const days = /^(\d+)d$/.exec(value);
  if (days !== null) return nowMs - Number(days[1]) * DAY_MS;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (date === null) return null;
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const start = new Date(year, month - 1, day);
  const real =
    start.getFullYear() === year && start.getMonth() === month - 1 && start.getDate() === day;
  return real ? start.getTime() : null;
}
