import type { MapRoot } from '../../domain/mind-map/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';

/** What the main pane shows, as the URL's hash says it. */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'note'; readonly path: VaultPath }
  | { readonly kind: 'tags'; readonly tag: string | null }
  | { readonly kind: 'graph' }
  /** A mind map from one note or tag; null follows the open note. */
  | { readonly kind: 'map'; readonly root: MapRoot | null }
  /** Make a quick note and open it: what a Shortcut or Dock icon opens. */
  | { readonly kind: 'new' };

const NOTE = '#/note/';
const TAGS = '#/tags';
const MAP = '#/map';

function decoded(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    // A hand-typed hash with a stray `%`: shown as the home page, not an error.
    return null;
  }
}

export function parseRoute(hash: string): Route {
  if (hash.startsWith(NOTE)) {
    const path = decoded(hash.slice(NOTE.length));
    return path === null || path === '' ? { kind: 'home' } : { kind: 'note', path };
  }
  if (hash === TAGS || hash === `${TAGS}/`) return { kind: 'tags', tag: null };
  if (hash.startsWith(`${TAGS}/`)) {
    const tag = decoded(hash.slice(TAGS.length + 1));
    return { kind: 'tags', tag: tag === '' ? null : tag };
  }
  if (hash === '#/graph') return { kind: 'graph' };
  if (hash === MAP || hash.startsWith(`${MAP}/`)) return { kind: 'map', root: mapRoot(hash) };
  if (hash === '#/new') return { kind: 'new' };
  return { kind: 'home' };
}

/** `#/map/note/<path>`, `#/map/tag/<key>`; anything else under `#/map` follows the open note. */
function mapRoot(hash: string): MapRoot | null {
  const [kind, ...rest] = hash.slice(MAP.length + 1).split('/');
  const value = decoded(rest.join('/'));
  if (value === null || value === '') return null;
  if (kind === 'note') return { kind: 'note', path: value };
  if (kind === 'tag') return { kind: 'tag', key: value };
  return null;
}

function formatMapRoute(root: MapRoot | null): string {
  if (root === null) return MAP;
  const value = root.kind === 'note' ? root.path : root.key;
  return `${MAP}/${root.kind}/${encodeURIComponent(value)}`;
}

export function formatRoute(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '#/';
    case 'note':
      return `${NOTE}${encodeURIComponent(route.path)}`;
    case 'tags':
      return route.tag === null ? TAGS : `${TAGS}/${encodeURIComponent(route.tag)}`;
    case 'graph':
      return '#/graph';
    case 'map':
      return formatMapRoute(route.root);
    case 'new':
      return '#/new';
  }
}

/** Whether the page was opened to make a new note: `#/new`, or `?new` on the URL. */
export function asksForNewNote(location: { readonly hash: string; readonly search: string }) {
  return location.hash === '#/new' || new URLSearchParams(location.search).has('new');
}
