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

/** A rough width per character at LABEL_PX, for telling whether two titles would touch. */
const CHAR_WIDTH_PX = LABEL_PX * 0.55;
const LINE_HEIGHT_PX = LABEL_PX * 1.3;

function shortened(title: string): string {
  return title.length <= LABEL_MAX_CHARS ? title : `${title.slice(0, LABEL_MAX_CHARS - 1)}…`;
}

const shownTitle = ({ node, lit, active }: LabelledNode) =>
  lit || active ? node.title : shortened(node.title);

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const overlaps = (one: Box, other: Box) =>
  one.left < other.right &&
  other.left < one.right &&
  one.top < other.bottom &&
  other.top < one.bottom;

/**
 * The titles that fit without touching another, in screen space: the open
 * note's and the lit ones always, then the best-connected first. A title left
 * out shows when the note or a neighbour is pointed at, or when zoomed in.
 */
export function uncrowded(
  labels: readonly LabelledNode[],
  positions: ReadonlyMap<string, Point>,
  zoom: number,
): LabelledNode[] {
  const forced = (label: LabelledNode) => label.lit || label.active;
  const byPriority = [...labels].sort(
    (left, right) => Number(forced(right)) - Number(forced(left)) || right.radius - left.radius,
  );
  const placed: Box[] = [];
  return byPriority.filter((label) => {
    const at = positions.get(label.node.id);
    if (at === undefined) return false;
    const half = (shownTitle(label).length * CHAR_WIDTH_PX) / 2;
    const top = (at.y + label.radius) * zoom + LABEL_GAP_PX;
    const box = {
      left: at.x * zoom - half,
      right: at.x * zoom + half,
      top,
      bottom: top + LINE_HEIGHT_PX,
    };
    if (!forced(label) && placed.some((other) => overlaps(box, other))) return false;
    placed.push(box);
    return true;
  });
}

/**
 * The notes' titles that fit (`uncrowded`), drawn after every dot so no dot
 * covers a title, and the lit ones last so they sit on top. Each hangs below its own dot at a fixed
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
  const ordered = uncrowded(labels, positions, zoom).sort(
    (left, right) => Number(left.lit) - Number(right.lit),
  );
  return (
    <g className="graph__labels" style={{ fontSize: LABEL_PX / zoom }}>
      {ordered.map((label) => {
        const { node, radius, lit, active, dim } = label;
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
            {shownTitle(label)}
          </text>
        );
      })}
    </g>
  );
}
