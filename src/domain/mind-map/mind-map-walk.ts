import type { PlacedNode } from './mind-map-layout.ts';
import type { MapEntity, MapRoot } from './mind-map-source.ts';
import { entityKey } from './mind-map-source.ts';

/** Where an arrow key moves on the map: to the parent, the first child, or a sibling. */
export type MapStep = 'parent' | 'child' | 'next' | 'previous';

/** The node an arrow key moves to from `id`, or `id` itself when there is nowhere to go. */
export function stepOnMap(nodes: readonly PlacedNode[], id: string, step: MapStep): string {
  const here = nodes.find((node) => node.node.id === id);
  if (here === undefined) return nodes[0]?.node.id ?? id;
  if (step === 'parent') return here.parentId ?? id;
  if (step === 'child') return here.node.children[0]?.id ?? id;
  const siblings = nodes.filter((node) => node.parentId === here.parentId);
  const at = siblings.indexOf(here) + (step === 'next' ? 1 : -1);
  return siblings[at]?.node.id ?? id;
}

/** The notes and tags from the root down to `id`, both ends included: what Focus adds to the trail. */
export function entitiesTo(nodes: readonly PlacedNode[], id: string): MapEntity[] {
  const byId = new Map(nodes.map((node) => [node.node.id, node]));
  const found: MapEntity[] = [];
  for (let at = byId.get(id); at !== undefined; at = byId.get(at.parentId ?? '')) {
    if (at.node.item.kind === 'entity') found.unshift(at.node.item.entity);
    if (at.parentId === null) break;
  }
  return found;
}

/** A note or a tag as a root; a ghost has no note to center on yet. */
export function rootOf(entity: MapEntity): MapRoot | null {
  if (entity.kind === 'note') return { kind: 'note', path: entity.path };
  if (entity.kind === 'tag') return { kind: 'tag', key: entity.key };
  return null;
}

export function sameRoot(left: MapRoot, right: MapRoot): boolean {
  return entityKey(left) === entityKey(right);
}

/** The roots walked through, and which of them the map shows now. */
export interface MapTrail {
  readonly roots: readonly MapRoot[];
  readonly at: number;
}

/**
 * The trail once the map shows `root`. A root already on it is a step back
 * or forward along it, which keeps the rest; any other starts a new trail.
 */
export function trailAt(trail: MapTrail | null, root: MapRoot): MapTrail {
  const at = trail?.roots.findIndex((known) => sameRoot(known, root)) ?? -1;
  return trail !== null && at >= 0 ? { roots: trail.roots, at } : { roots: [root], at: 0 };
}

/**
 * The trail after Focus on a node: the way from the current root to it is
 * walked onto the trail, and anything ahead of the current root is dropped,
 * as a browser drops Forward when a new page opens.
 */
export function focusTrail(trail: MapTrail, way: readonly MapEntity[]): MapTrail {
  const steps = way
    .map(rootOf)
    .filter((root): root is MapRoot => root !== null)
    .slice(1);
  if (steps.length === 0) return trail;
  const roots = [...trail.roots.slice(0, trail.at + 1), ...steps];
  return { roots, at: roots.length - 1 };
}
