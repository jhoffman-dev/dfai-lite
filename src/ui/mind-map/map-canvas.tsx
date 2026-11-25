import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { branchCurve, stepOnMap, type ResolvedAppearances } from '../../application/index.ts';
import type { MapLayout, MapNode, MapStep, PlacedNode } from '../../domain/mind-map/index.ts';
import { MapNodeView, type NodeHandlers } from './map-node.tsx';
import { Icon } from '../shell/icons.tsx';
import {
  fitMap,
  panToShow,
  usePanZoom,
  useStageSize,
  zoomAbout,
  type Camera,
  type StageSize,
} from './map-viewport.ts';

const STEPS: Readonly<Record<string, MapStep>> = {
  ArrowLeft: 'parent',
  ArrowRight: 'child',
  ArrowUp: 'previous',
  ArrowDown: 'next',
};

/** Before a node is measured, a guess at its width from its title. */
const guessWidth = (node: MapNode) => Math.min(220, 40 + node.title.length * 7);

export interface MapCanvasProps {
  readonly layout: MapLayout;
  readonly looks: ResolvedAppearances;
  readonly handlers: Omit<NodeHandlers, 'onSelect'>;
  /** Enter on a node: as a click on its label. */
  readonly onEnter: (node: MapNode) => void;
}

/** A node held still on the screen while the map reshapes around it: where it was, in map units. */
interface Pin {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/**
 * The camera, shifted so a pinned node stays where it was before the map
 * changed, then panned just enough to show what opened under it.
 */
function pinned(view: Camera, pin: Pin | null, layout: MapLayout, size: StageSize): Camera {
  const now = pin === null ? undefined : layout.nodes.find((placed) => placed.node.id === pin.id);
  if (pin === null || now === undefined) return view;
  const held = {
    ...view,
    x: view.x + (pin.x - now.x) * view.k,
    y: view.y + (pin.y - now.y) * view.k,
  };
  return now.node.state === 'open' ? panToShow(held, subtreeBox(layout, now), size) : held;
}

/** The box around a node and everything under it, in map units, a column's width to its right. */
function subtreeBox(layout: MapLayout, top: PlacedNode) {
  const inside = new Set([top.node.id]);
  const box = {
    left: top.x,
    right: top.x + COLUMN_ROOM,
    top: top.y - ROW_ROOM,
    bottom: top.y + ROW_ROOM,
  };
  for (const placed of layout.nodes) {
    if (placed.parentId === null || !inside.has(placed.parentId)) continue;
    inside.add(placed.node.id);
    box.right = Math.max(box.right, placed.x + COLUMN_ROOM);
    box.top = Math.min(box.top, placed.y - ROW_ROOM);
    box.bottom = Math.max(box.bottom, placed.y + ROW_ROOM);
  }
  return box;
}

const COLUMN_ROOM = 230;
const ROW_ROOM = 16;

/**
 * The map drawn: nodes as HTML (so titles truncate and icons are the app's
 * own), the curves between them as one SVG underneath, both on one panned
 * and zoomed plane. The stage is bound to the pane: the map never sizes the
 * page. Arrow keys walk it, Enter opens, Space opens or shuts, F focuses.
 */
export function MapCanvas({ layout, looks, handlers, onEnter }: MapCanvasProps) {
  const stage = useRef<HTMLDivElement>(null);
  const size = useStageSize(stage);
  // Null until the person pans, zooms or opens a node: until then the map is fitted.
  const [camera, setCamera] = useState<Camera | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const [focusedId, setFocusedId] = useState(layout.nodes[0]?.node.id ?? '');
  const widths = useWidths(stage, layout);
  const view = pinned(camera ?? fitMap(layout.bounds, size), pin, layout, size);
  const moveCamera = (next: Camera | null) => {
    setCamera(next);
    setPin(null);
  };
  const pan = usePanZoom(view, moveCamera);
  const byId = new Map(layout.nodes.map((placed) => [placed.node.id, placed]));
  const focused = byId.get(focusedId) ?? layout.nodes[0];
  const widthOf = (placed: PlacedNode) => widths.get(placed.node.id) ?? guessWidth(placed.node);

  const moveFocus = (id: string) => {
    setFocusedId(id);
    const target = byId.get(id);
    if (target === undefined) return;
    const box = {
      left: target.x,
      right: target.x + widthOf(target),
      top: target.y - 16,
      bottom: target.y + 16,
    };
    moveCamera(panToShow(view, box, size));
    nodeElement(stage.current, id)?.focus({ preventScroll: true });
  };

  // Opening a note leaves the map as it is; anything else reshapes it around the node.
  const reshape = (node: MapNode, run: () => void) => {
    const placed = byId.get(node.id);
    setCamera(view);
    setPin(placed === undefined ? null : { id: node.id, x: placed.x, y: placed.y });
    run();
  };
  const nodeHandlers: NodeHandlers = {
    ...handlers,
    onToggle: (node) => reshape(node, () => handlers.onToggle(node)),
    onPress: (node, event: MouseEvent) =>
      node.item.kind === 'entity'
        ? handlers.onPress(node, event)
        : reshape(node, () => handlers.onPress(node, event)),
    onSelect: setFocusedId,
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (focused === undefined || event.metaKey || event.ctrlKey || event.altKey) return;
    const { node } = focused;
    const step = STEPS[event.key];
    if (step !== undefined) moveFocus(stepOnMap(layout.nodes, node.id, step));
    else if (event.key === 'Enter' && node.item.kind === 'entity') onEnter(node);
    else if (event.key === 'Enter') reshape(node, () => onEnter(node));
    else if (event.key === ' ') nodeHandlers.onToggle(node);
    else if (event.key === 'f' && focused.parentId !== null) handlers.onFocusRoot(node);
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={stage}
      className="mind-map__stage"
      onWheel={pan.onWheel}
      onPointerDown={pan.onPointerDown}
      onPointerMove={pan.onPointerMove}
      onPointerUp={pan.onPointerUp}
      onPointerCancel={pan.onPointerUp}
    >
      <div
        className="mind-map__plane"
        role="tree"
        aria-label="Mind map"
        onKeyDown={onKeyDown}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        <Curves layout={layout} byId={byId} widthOf={widthOf} />
        {layout.nodes.map((placed) => (
          <MapNodeView
            key={placed.node.id}
            placed={placed}
            root={placed.parentId === null}
            focused={placed === focused}
            looks={looks}
            handlers={nodeHandlers}
          />
        ))}
      </div>
      <div className="mind-map__zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => moveCamera(zoomAbout(view, centerOf(size), 0.8))}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => moveCamera(zoomAbout(view, centerOf(size), 1.25))}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Fit the map"
          title="Fit the map to the view"
          onClick={() => moveCamera(null)}
        >
          <Icon name="fit" size={14} />
        </button>
      </div>
    </div>
  );
}

const centerOf = (size: StageSize) => ({ x: size.width / 2, y: size.height / 2 });

function Curves({
  layout,
  byId,
  widthOf,
}: {
  layout: MapLayout;
  byId: ReadonlyMap<string, PlacedNode>;
  widthOf: (placed: PlacedNode) => number;
}) {
  return (
    <svg className="mind-map__curves" aria-hidden="true" width="1" height="1">
      {layout.nodes.map((child) => {
        const parent = child.parentId === null ? undefined : byId.get(child.parentId);
        if (parent === undefined) return null;
        const from = { x: parent.x + widthOf(parent), y: parent.y };
        return (
          <path
            key={child.node.id}
            className={`mind-map__curve mind-map__curve--${child.node.item.kind}`}
            d={branchCurve(from, { x: child.x, y: child.y })}
          />
        );
      })}
    </svg>
  );
}

function nodeElement(stage: HTMLElement | null, id: string): HTMLElement | undefined {
  const nodes = stage?.querySelectorAll<HTMLElement>('[data-id]') ?? [];
  return [...nodes].find((element) => element.dataset['id'] === id);
}

/** Each node's drawn width, as the browser lays it out: where its curves leave from. */
function useWidths(stage: RefObject<HTMLDivElement | null>, layout: MapLayout) {
  const [widths, setWidths] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    const elements = stage.current?.querySelectorAll<HTMLElement>('[data-id]') ?? [];
    // jsdom has no ResizeObserver: there the widths stay guessed.
    if (elements.length === 0 || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      setWidths((known) => {
        const next = new Map(known);
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          next.set(element.dataset['id'] ?? '', element.offsetWidth);
        }
        return next;
      });
    });
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [stage, layout]);
  return widths;
}
