import type { GraphNode } from '../../domain/index/index.ts';
import type { Point } from './use-force-layout.ts';

/** A title's size on screen, whatever the zoom: the graph scales, the words do not. */
const LABEL_PX = 11;
/** Screen pixels between a dot's edge and the top of its title. */
const LABEL_GAP_PX = 3;
/** A title longer than this is cut short, unless it is pointed at or open. */
const LABEL_MAX_CHARS = 24;

export interface LabelledNode {
  readonly node: GraphNode;
  readonly radius: number;
  /** Pointed at, a neighbour of the note pointed at, or the open note: drawn in full, on top. */
  readonly lit: boolean;
  readonly active: boolean;
  /** Something else is pointed at and this note is not near it. */
  readonly dim: boolean;
}

function shortened(title: string): string {
  return title.length <= LABEL_MAX_CHARS ? title : `${title.slice(0, LABEL_MAX_CHARS - 1)}…`;
}

/**
 * The notes' titles, drawn after every dot so no dot covers a title, and the
 * lit ones last so they sit on top. Each hangs below its own dot at a fixed
 * screen size, with a halo of the ground colour so lines under it stay quiet.
 */
export function GraphLabels({
  labels,
  positions,
  zoom,
}: {
  labels: readonly LabelledNode[];
  positions: ReadonlyMap<string, Point>;
  zoom: number;
}) {
  const ordered = [...labels].sort((left, right) => Number(left.lit) - Number(right.lit));
  return (
    <g className="graph__labels" style={{ fontSize: LABEL_PX / zoom }}>
      {ordered.map(({ node, radius, lit, active, dim }) => {
        const at = positions.get(node.id);
        if (at === undefined) return null;
        const className = [
          'graph__label',
          lit ? 'graph__label--lit' : '',
          active ? 'graph__label--active' : '',
          dim ? 'graph__label--dim' : '',
        ]
          .filter((name) => name !== '')
          .join(' ');
        return (
          <text
            key={node.id}
            className={className}
            x={at.x}
            y={at.y + radius + LABEL_GAP_PX / zoom}
            strokeWidth={3 / zoom}
          >
            {lit || active ? node.title : shortened(node.title)}
          </text>
        );
      })}
    </g>
  );
}
