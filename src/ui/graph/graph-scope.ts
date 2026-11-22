import type { GraphEdge, GraphNode, VaultGraph } from '../../domain/index/index.ts';

/** How far a local graph reaches from the open note. */
export type GraphDepth = 1 | 2;

/**
 * Past this many notes the force layout in SVG stops feeling instant, so the
 * view draws the most connected ones and says how many it left out.
 */
export const GRAPH_NODE_LIMIT = 600;

/** What the person asked to see: the whole vault or the open note's neighborhood, narrowed by a filter. */
export interface GraphScope {
  readonly center: string | null;
  readonly depth: GraphDepth;
  readonly query: string;
}

export interface ScopedGraph {
  readonly graph: VaultGraph;
  /** Notes left out by the cap, not by the scope or the filter. */
  readonly hidden: number;
}

/** Each node's neighbors, either way along an edge. */
export function neighborsOf(edges: readonly GraphEdge[]): ReadonlyMap<string, ReadonlySet<string>> {
  const neighbors = new Map<string, Set<string>>();
  const add = (from: string, to: string): void => {
    const set = neighbors.get(from);
    if (set === undefined) neighbors.set(from, new Set([to]));
    else set.add(to);
  };
  for (const { source, target } of edges) {
    add(source, target);
    add(target, source);
  }
  return neighbors;
}

/** How big a node is drawn: by how many notes it touches, on a square-root scale with a ceiling. */
export function nodeRadius(degree: number): number {
  return Math.min(18, Math.round((5 + 2 * Math.sqrt(Math.max(0, degree))) * 10) / 10);
}

/**
 * The part of the graph on screen. The reach from the center comes first, then
 * the filter (the center always stays: it is the point of a local graph), then
 * the cap, so a big vault degrades to its best-connected notes.
 */
export function scopeGraph(graph: VaultGraph, scope: GraphScope): ScopedGraph {
  let visible = graph;
  if (scope.center !== null) {
    if (!graph.nodes.some((node) => node.id === scope.center)) return { graph: EMPTY, hidden: 0 };
    visible = restrict(visible, withinReach(visible.edges, scope.center, scope.depth));
  }
  const query = scope.query.trim().toLowerCase();
  if (query !== '') {
    const matching = visible.nodes.filter(
      (node) => node.id === scope.center || matches(node, query),
    );
    visible = restrict(visible, new Set(matching.map((node) => node.id)));
  }
  return capGraph(visible, GRAPH_NODE_LIMIT);
}

const EMPTY: VaultGraph = { nodes: [], edges: [] };

const matches = (node: GraphNode, query: string): boolean =>
  node.title.toLowerCase().includes(query) ||
  (node.kind === 'note' && node.id.toLowerCase().includes(query));

/** Breadth first from the center, `depth` steps out along edges either way. */
function withinReach(edges: readonly GraphEdge[], center: string, depth: number): Set<string> {
  const neighbors = neighborsOf(edges);
  const reached = new Set([center]);
  let frontier = [center];
  for (let step = 0; step < depth; step += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of neighbors.get(id) ?? []) {
        if (reached.has(neighbor)) continue;
        reached.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return reached;
}

/** At most `limit` nodes, the most connected first; ties by id, so the cut never moves between renders. */
function capGraph(graph: VaultGraph, limit: number): ScopedGraph {
  if (graph.nodes.length <= limit) return { graph, hidden: 0 };
  const neighbors = neighborsOf(graph.edges);
  const degree = (node: GraphNode): number => neighbors.get(node.id)?.size ?? 0;
  const kept = [...graph.nodes]
    .sort(
      (left, right) =>
        degree(right) - degree(left) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .slice(0, limit);
  return {
    graph: restrict(graph, new Set(kept.map((node) => node.id))),
    hidden: graph.nodes.length - kept.length,
  };
}

/** The graph with only these nodes, and the edges between two of them. */
function restrict(graph: VaultGraph, keep: ReadonlySet<string>): VaultGraph {
  return {
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
  };
}
