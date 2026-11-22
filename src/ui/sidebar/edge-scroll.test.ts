import { describe, expect, it } from 'vitest';
import { EDGE_PX, edgeScrollStep, MAX_STEP_PX } from './edge-scroll.ts';

describe('a drag near the tree’s edge', () => {
  const box = { top: 100, bottom: 500, left: 0, right: 260 };
  const at = (y: number) => edgeScrollStep({ x: 100, y }, box);

  it('scrolls nothing away from the edges', () => {
    expect(at(300)).toBe(0);
    expect(at(box.top + EDGE_PX)).toBe(0);
    expect(at(box.bottom - EDGE_PX)).toBe(0);
  });

  it('scrolls up near the top and down near the bottom, faster nearer the edge', () => {
    expect(at(box.top + EDGE_PX - 1)).toBe(-1);
    expect(at(box.top)).toBe(-MAX_STEP_PX);
    expect(at(box.bottom - EDGE_PX / 2)).toBe(MAX_STEP_PX / 2);
    expect(at(box.bottom)).toBe(MAX_STEP_PX);
  });

  it('scrolls no faster past the edge, over the heading above the tree', () => {
    expect(at(box.top - 40)).toBe(-MAX_STEP_PX);
    expect(at(box.bottom + 40)).toBe(MAX_STEP_PX);
  });

  it('scrolls nothing beside the tree, or for a tree not laid out yet', () => {
    expect(edgeScrollStep({ x: 300, y: box.top }, box)).toBe(0);
    expect(edgeScrollStep({ x: 0, y: 0 }, { top: 0, bottom: 0, left: 0, right: 0 })).toBe(0);
  });
});
