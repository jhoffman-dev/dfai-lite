import type { MapNode } from './mind-map-tree.ts';

/** Where one node sits: its left edge and middle, in map units (pixels at zoom 1). */
export interface PlacedNode {
  readonly node: MapNode;
  readonly parentId: string | null;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
}

export interface MapLayout {
  /** Parents before their children, siblings top to bottom. */
  readonly nodes: readonly PlacedNode[];
  readonly bounds: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

export interface LayoutMetrics {
  /** The height one leaf takes, gap included. */
  readonly row: number;
  /** Extra room between a sibling with its own children and the one next to it. */
  readonly branchGap: number;
  /** The width of a column of notes and tags, curve room included. */
  readonly entityColumn: number;
  /** The width of a column of branch labels. */
  readonly branchColumn: number;
}

export const DEFAULT_METRICS: LayoutMetrics = {
  row: 34,
  branchGap: 12,
  entityColumn: 260,
  branchColumn: 150,
};

/**
 * Where a column starts. The map alternates columns: notes at even depths,
 * branch labels ("Links", "Backlinks") at odd ones.
 */
export function columnX(depth: number, metrics: LayoutMetrics): number {
  const entities = Math.ceil(depth / 2);
  const branches = Math.floor(depth / 2);
  return entities * metrics.entityColumn + branches * metrics.branchColumn;
}

/**
 * A horizontal tidy tree, as a mind map is drawn: the root at the left, each
 * depth a column to its right, every leaf a row of its own, top to bottom in
 * the tree's order, and each parent centered on its children. The same tree
 * always lands in the same place; nothing overlaps.
 */
export function layoutMindMap(root: MapNode, metrics: LayoutMetrics = DEFAULT_METRICS): MapLayout {
  const placed: PlacedNode[] = [];
  let cursor = 0;
  const place = (node: MapNode, parentId: string | null, depth: number): number => {
    const at = placed.length;
    placed.push({ node, parentId, depth, x: columnX(depth, metrics), y: 0 });
    let y: number;
    if (node.children.length === 0) {
      y = cursor;
      cursor += metrics.row;
    } else {
      const ys = node.children.map((child, index) => {
        const previous = node.children[index - 1];
        if (index > 0 && (child.children.length > 0 || (previous?.children.length ?? 0) > 0)) {
          cursor += metrics.branchGap;
        }
        return place(child, node.id, depth + 1);
      });
      y = ((ys[0] as number) + (ys[ys.length - 1] as number)) / 2;
    }
    placed[at] = { ...(placed[at] as PlacedNode), y };
    return y;
  };
  const rootY = place(root, null, 0);
  // The root on the zero line: the map grows up and down from it.
  const nodes = placed.map((entry) => ({ ...entry, y: entry.y - rootY }));
  return { nodes, bounds: boundsOf(nodes, metrics) };
}

function boundsOf(nodes: readonly PlacedNode[], metrics: LayoutMetrics): MapLayout['bounds'] {
  const ys = nodes.map((node) => node.y);
  const deepest = Math.max(...nodes.map((node) => node.depth));
  const half = metrics.row / 2;
  return {
    left: 0,
    top: Math.min(...ys) - half,
    right: columnX(deepest + 1, metrics),
    bottom: Math.max(...ys) + half,
  };
}

/** The curve from a parent's right edge to a child's left: an S, flat at both ends. */
export function branchCurve(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const middle = (from.x + to.x) / 2;
  return `M${from.x} ${from.y}C${middle} ${from.y} ${middle} ${to.y} ${to.x} ${to.y}`;
}
