import type { MouseEvent } from 'react';
import { tagHue, type ResolvedAppearances } from '../../application/index.ts';
import type { MapNode, PlacedNode } from '../../domain/mind-map/index.ts';
import type { ResolvedAppearance } from '../../domain/appearance/index.ts';
import { LookGlyph } from '../appearance/look-glyph.tsx';
import { Icon } from '../shell/icons.tsx';

export interface NodeHandlers {
  /** The label was clicked: open the note or tag, open or shut a branch, or show more. */
  readonly onPress: (node: MapNode, event: MouseEvent) => void;
  /** Re-root the map here. */
  readonly onFocusRoot: (node: MapNode) => void;
  readonly onToggle: (node: MapNode) => void;
  /** The pointer chose this node: keyboard focus follows. */
  readonly onSelect: (id: string) => void;
}

/** What kind of node it is, as the stylesheet reads it. */
function kindOf(node: MapNode): string {
  const { item } = node;
  if (item.kind !== 'entity') return item.kind;
  return item.entity.kind;
}

/** A node's name for a screen reader: its title, and what it is when the title does not say. */
export function spokenName(node: MapNode): string {
  const { item } = node;
  if (item.kind === 'branch') return `${node.title}, ${item.total}`;
  if (item.kind === 'more') return `Show ${item.hidden} more`;
  if (item.entity.kind === 'ghost') return `${node.title}, no note yet`;
  if (node.state === 'repeat') return `${node.title}, already on the map`;
  return node.title;
}

function hoverText(node: MapNode): string {
  const { item } = node;
  if (item.kind === 'more') return `Show more of this branch (${item.hidden} hidden)`;
  if (item.kind === 'branch') return `${node.title}: click to show or hide`;
  if (item.entity.kind === 'ghost') return `${node.title} (no note yet: click to create)`;
  const repeat = node.state === 'repeat' ? ' (already on the map)' : '';
  return `${node.title}${repeat}. Click to open, double-click to focus the map here.`;
}

/** One node: a pill for a note or tag, a quiet label for a branch, a link for "more". */
export function MapNodeView({
  placed,
  root,
  focused,
  looks,
  handlers,
}: {
  placed: PlacedNode;
  root: boolean;
  focused: boolean;
  looks: ResolvedAppearances;
  handlers: NodeHandlers;
}) {
  const { node } = placed;
  const { item } = node;
  const entity = item.kind === 'entity' ? item.entity : null;
  const look = entity?.kind === 'note' ? (looks.get(entity.path) ?? null) : null;
  const hue = entity?.kind === 'tag' ? tagHue(entity.key) : (look?.hue ?? undefined);
  const expandable = node.state === 'open' || node.state === 'closed';
  const canFocus = !root && (entity?.kind === 'note' || entity?.kind === 'tag');
  const className = [
    'mind-map__node',
    `mind-map__node--${kindOf(node)}`,
    root ? 'mind-map__node--root' : '',
    node.state === 'repeat' ? 'mind-map__node--repeat' : '',
  ]
    .filter((name) => name !== '')
    .join(' ');

  return (
    <div
      className={className}
      data-id={node.id}
      role="treeitem"
      aria-label={spokenName(node)}
      aria-level={placed.depth + 1}
      aria-expanded={expandable ? node.state === 'open' : undefined}
      aria-selected={focused}
      tabIndex={focused ? 0 : -1}
      style={{ left: placed.x, top: placed.y }}
      onPointerDown={() => handlers.onSelect(node.id)}
    >
      <button
        type="button"
        tabIndex={-1}
        className="mind-map__label"
        data-hue={hue}
        title={hoverText(node)}
        onClick={(event) => handlers.onPress(node, event)}
        onAuxClick={(event) => event.button === 1 && handlers.onPress(node, event)}
        onDoubleClick={() => canFocus && handlers.onFocusRoot(node)}
      >
        <NodeGlyph node={node} look={look} />
        <span className="mind-map__title">
          {item.kind === 'more' ? `${item.hidden} more…` : node.title}
        </span>
        {item.kind === 'branch' ? <span className="mind-map__count">{item.total}</span> : null}
      </button>
      {canFocus ? (
        <button
          type="button"
          tabIndex={-1}
          className="mind-map__focus"
          aria-label={`Focus the map on ${node.title}`}
          title="Focus the map here"
          onClick={() => handlers.onFocusRoot(node)}
        >
          <Icon name="target" size={13} />
        </button>
      ) : null}
      {expandable && item.kind === 'entity' ? (
        <button
          type="button"
          tabIndex={-1}
          className="mind-map__toggle"
          aria-label={`${node.state === 'open' ? 'Collapse' : 'Expand'} ${node.title}`}
          title={node.state === 'open' ? 'Collapse' : 'Show what it links to'}
          onClick={() => handlers.onToggle(node)}
        >
          {node.state === 'open' ? '−' : '+'}
        </button>
      ) : null}
    </div>
  );
}

function NodeGlyph({ node, look }: { node: MapNode; look: ResolvedAppearance | null }) {
  const { item } = node;
  if (item.kind !== 'entity') return null;
  if (node.state === 'repeat') return <Icon name="arrow-left" size={13} />;
  switch (item.entity.kind) {
    case 'note':
      return <LookGlyph look={look} fallback="doc" size={14} />;
    case 'ghost':
      return <Icon name="plus" size={13} />;
    case 'tag':
      return null;
  }
}
