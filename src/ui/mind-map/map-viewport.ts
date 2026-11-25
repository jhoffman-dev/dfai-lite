import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { MapLayout } from '../../domain/mind-map/index.ts';

/** Pan and zoom: where the map's origin (the root's left middle) sits on the stage, and the scale. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export interface StageSize {
  readonly width: number;
  readonly height: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
/** Never blown up past life size when fitted, and never shrunk past legibility. */
const FIT_MAX = 1;
const FIT_MIN = 0.5;
const PAD = 32;
const CLICK_SLOP = 4;

/**
 * The view that shows the map: shrunk to fit if it can be read that small,
 * left-aligned so the root sits center-left, and centered top to bottom
 * when it fits, else centered on the root.
 */
export function fitMap(bounds: MapLayout['bounds'], size: StageSize): Camera {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const fit = Math.min((size.width - 2 * PAD) / width, (size.height - 2 * PAD) / height);
  const k = Math.min(FIT_MAX, Math.max(FIT_MIN, fit));
  const x = PAD - bounds.left * k;
  const y =
    height * k <= size.height - 2 * PAD
      ? size.height / 2 - ((bounds.top + bounds.bottom) / 2) * k
      : size.height / 2;
  return { x, y, k };
}

/** The smallest pan that brings a box (in map units) into the stage, or the view as it is. */
export function panToShow(
  view: Camera,
  box: { left: number; top: number; right: number; bottom: number },
  size: StageSize,
): Camera {
  const shift = (low: number, high: number, extent: number) =>
    low < PAD ? PAD - low : high > extent - PAD ? Math.max(extent - PAD - high, PAD - low) : 0;
  const dx = shift(view.x + box.left * view.k, view.x + box.right * view.k, size.width);
  const dy = shift(view.y + box.top * view.k, view.y + box.bottom * view.k, size.height);
  return dx === 0 && dy === 0 ? view : { ...view, x: view.x + dx, y: view.y + dy };
}

/** The zoom about a point on the stage: the map under it stays under it. */
export function zoomAbout(view: Camera, at: { x: number; y: number }, factor: number) {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
  const scale = k / view.k;
  return { k, x: at.x - (at.x - view.x) * scale, y: at.y - (at.y - view.y) * scale };
}

/** The stage's size in pixels, followed as the pane resizes. */
export function useStageSize(stage: { current: HTMLElement | null }): StageSize {
  const [size, setSize] = useState<StageSize>({ width: 800, height: 600 });
  useEffect(() => {
    const element = stage.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [stage]);
  return size;
}

/** Dragging the ground pans; the wheel zooms about the pointer. A press on a node is its own. */
export function usePanZoom(view: Camera, setView: (view: Camera) => void) {
  const pan = useRef<{ x: number; y: number; view: Camera; moved: boolean } | null>(null);
  return {
    onWheel(event: WheelEvent<HTMLElement>) {
      const box = event.currentTarget.getBoundingClientRect();
      const at = { x: event.clientX - box.left, y: event.clientY - box.top };
      setView(zoomAbout(view, at, Math.exp(-event.deltaY * 0.0015)));
    },
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || (event.target as Element).closest('button') !== null) return;
      // jsdom and some pointer types cannot capture; the pan still works while over the stage.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      pan.current = { x: event.clientX, y: event.clientY, view, moved: false };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const now = pan.current;
      if (now === null) return;
      const dx = event.clientX - now.x;
      const dy = event.clientY - now.y;
      if (!now.moved && Math.hypot(dx, dy) <= CLICK_SLOP) return;
      now.moved = true;
      setView({ ...now.view, x: now.view.x + dx, y: now.view.y + dy });
    },
    onPointerUp() {
      pan.current = null;
    },
  };
}
