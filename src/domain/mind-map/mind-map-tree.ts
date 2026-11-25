import {
  branchesOf,
  entityKey,
  entityTitle,
  hasBranches,
  rootEntity,
  type BranchKind,
  type MapEntity,
  type MapRoot,
  type MindMapSource,
} from './mind-map-source.ts';

/** What one node of the map stands for. */
export type MapItem =
  | { readonly kind: 'entity'; readonly entity: MapEntity }
  | { readonly kind: 'branch'; readonly branch: BranchKind; readonly total: number }
  /** The rest of a capped branch: `hidden` more wait behind it. */
  | { readonly kind: 'more'; readonly branch: BranchKind; readonly hidden: number };

/**
 * - `open`: its children are shown.
 * - `closed`: it has children, not loaded yet.
 * - `leaf`: nothing hangs off it.
 * - `repeat`: it is already on the path from the root: shown, never expanded again.
 * - `limit`: as deep as the map goes; Focus re-roots on it to go further.
 */
export type NodeState = 'open' | 'closed' | 'leaf' | 'repeat' | 'limit';

export interface MapNode {
  /** Its place in the tree, unique on the map: the same thing twice is two nodes. */
  readonly id: string;
  readonly item: MapItem;
  readonly title: string;
  readonly state: NodeState;
  readonly children: readonly MapNode[];
}

/** What the person has done to the map: opened or shut nodes, and asked for more. */
export interface MapView {
  /** A node's open state where it differs from its default: notes start shut, branches open. */
  readonly toggled: ReadonlyMap<string, boolean>;
  /** How many of a branch's entities show, by the branch node's id, past the cap. */
  readonly shown: ReadonlyMap<string, number>;
}

export interface MapOptions {
  /** How many of a branch's entities show before a "more" node. */
  readonly cap: number;
  /** How many steps of notes and tags from the root can be opened. */
  readonly maxDepth: number;
  /** Whether meeting transcripts show; they are noise on most maps. */
  readonly transcripts: boolean;
}

export const DEFAULT_MAP_OPTIONS: MapOptions = { cap: 30, maxDepth: 8, transcripts: false };
export const EMPTY_MAP_VIEW: MapView = { toggled: new Map(), shown: new Map() };

export const ROOT_ID = 'root';
// A character no title or path holds, so two different places never share an id.
const JOIN = '\u001f';

const BRANCH_TITLES: Readonly<Record<BranchKind, string>> = {
  links: 'Links',
  backlinks: 'Backlinks',
  tags: 'Tags',
  subtags: 'Nested tags',
  notes: 'Notes',
};

interface Walk {
  readonly source: MindMapSource;
  readonly view: MapView;
  readonly options: MapOptions;
}

/**
 * The map from `root` as far as it has been opened: the root and its
 * branches are open, every other note waits to be opened, one level at a
 * time. Only what is open is read from the index. Null when the root's note
 * or tag is gone.
 */
export function buildMindMap(
  source: MindMapSource,
  root: MapRoot,
  view: MapView = EMPTY_MAP_VIEW,
  options: MapOptions = DEFAULT_MAP_OPTIONS,
): MapNode | null {
  const walk: Walk = { source: withTagCountsOnce(source), view, options };
  const entity = rootEntity(walk.source, root);
  if (entity === null) return null;
  return entityNode(walk, { id: ROOT_ID, entity, path: new Set(), depth: 0 });
}

interface Place {
  readonly id: string;
  readonly entity: MapEntity;
  /** The entities between the root and here, by `entityKey`. */
  readonly path: ReadonlySet<string>;
  readonly depth: number;
}

function entityNode(walk: Walk, place: Place): MapNode {
  const { id, entity } = place;
  const base = { id, item: { kind: 'entity', entity } as const, title: entityTitle(entity) };
  const key = entityKey(entity);
  if (place.path.has(key)) return { ...base, state: 'repeat', children: [] };
  if (!hasBranches(walk.source, entity, walk.options))
    return { ...base, state: 'leaf', children: [] };
  if (place.depth >= walk.options.maxDepth) return { ...base, state: 'limit', children: [] };
  const open = walk.view.toggled.get(id) ?? id === ROOT_ID;
  if (!open) return { ...base, state: 'closed', children: [] };
  const path = new Set(place.path).add(key);
  const children = branchesOf(walk.source, entity, walk.options).map((branch) =>
    branchNode(walk, {
      id: `${id}${JOIN}${branch.kind}`,
      branch: branch.kind,
      entities: branch.entities,
      path,
      depth: place.depth + 1,
    }),
  );
  return { ...base, state: 'open', children };
}

interface BranchPlace {
  readonly id: string;
  readonly branch: BranchKind;
  readonly entities: readonly MapEntity[];
  readonly path: ReadonlySet<string>;
  readonly depth: number;
}

function branchNode(walk: Walk, place: BranchPlace): MapNode {
  const { id, branch, entities } = place;
  const item = { kind: 'branch', branch, total: entities.length } as const;
  const base = { id, item, title: BRANCH_TITLES[branch] };
  if (!(walk.view.toggled.get(id) ?? true)) return { ...base, state: 'closed', children: [] };
  const limit = Math.max(walk.options.cap, walk.view.shown.get(id) ?? 0);
  const children: MapNode[] = entities.slice(0, limit).map((entity) =>
    entityNode(walk, {
      id: `${id}${JOIN}${entityKey(entity)}`,
      entity,
      path: place.path,
      depth: place.depth,
    }),
  );
  const hidden = entities.length - children.length;
  if (hidden > 0) children.push(moreNode(`${id}${JOIN}more`, branch, hidden));
  return { ...base, state: 'open', children };
}

function moreNode(id: string, branch: BranchKind, hidden: number): MapNode {
  return {
    id,
    item: { kind: 'more', branch, hidden },
    title: `${hidden} more`,
    state: 'leaf',
    children: [],
  };
}

/** The index sorts every tag each time it counts them: once per map is enough. */
function withTagCountsOnce(source: MindMapSource): MindMapSource {
  let counts: ReturnType<MindMapSource['tagCounts']> | null = null;
  return {
    has: (path) => source.has(path),
    outgoing: (path) => source.outgoing(path),
    backlinks: (path) => source.backlinks(path),
    tagsOf: (path) => source.tagsOf(path),
    notesWithTag: (key, options) => source.notesWithTag(key, options),
    tagCounts: () => (counts ??= source.tagCounts()),
  };
}

/** The view after a node is opened or shut. */
export function toggleNode(view: MapView, node: MapNode): MapView {
  if (node.state !== 'open' && node.state !== 'closed') return view;
  const toggled = new Map(view.toggled).set(node.id, node.state === 'closed');
  return { ...view, toggled };
}

/** The view after a branch's "more" node is clicked: `cap` more of it show. */
export function showMore(view: MapView, moreId: string, cap: number): MapView {
  const branchId = moreId.slice(0, moreId.lastIndexOf(JOIN));
  const shown = new Map(view.shown).set(branchId, (view.shown.get(branchId) ?? cap) + cap);
  return { ...view, shown };
}
