import type { GraphNode } from '../../domain/index/index.ts';
import { uncrowded, type LabelledNode } from './graph-labels.tsx';

const label = (id: string, extra: Partial<LabelledNode> = {}): LabelledNode => ({
  node: { id, kind: 'note', title: id } satisfies GraphNode,
  radius: 5,
  lit: false,
  active: false,
  dim: false,
  ...extra,
});

const ids = (labels: readonly LabelledNode[]) => labels.map(({ node }) => node.id).sort();

describe('uncrowded', () => {
  const positions = new Map([
    ['Mara Quill', { x: 0, y: 0 }],
    ['Tobias Fenn', { x: 10, y: 4 }],
    ['Garden shed', { x: 300, y: 0 }],
  ]);

  it('keeps the better connected of two titles that would touch, and any title clear of others', () => {
    const labels = [label('Mara Quill'), label('Tobias Fenn', { radius: 9 }), label('Garden shed')];
    expect(ids(uncrowded(labels, positions, 1))).toEqual(['Garden shed', 'Tobias Fenn']);
  });

  it('always keeps the open note and the lit ones, even when they touch', () => {
    const labels = [label('Mara Quill', { active: true }), label('Tobias Fenn', { lit: true })];
    expect(ids(uncrowded(labels, positions, 1))).toEqual(['Mara Quill', 'Tobias Fenn']);
  });

  it('makes room as the graph is zoomed in', () => {
    const labels = [label('Mara Quill'), label('Tobias Fenn')];
    expect(uncrowded(labels, positions, 1)).toHaveLength(1);
    expect(uncrowded(labels, positions, 12)).toHaveLength(2);
  });
});
