import { fireEvent, render, screen } from '@testing-library/react';
import { buildMindMap, layoutMindMap } from '../../application/index.ts';
import type { MapNode, MindMapSource } from '../../domain/mind-map/index.ts';
import { MapCanvas } from './map-canvas.tsx';
import { fitMap, panToShow, zoomAbout } from './map-viewport.ts';

/** Three notes, written out as the index answers: the UI may import domain types only. */
const source: MindMapSource = {
  has: (path) => ['Plan.md', 'Mara Quill.md', 'Tobias Fenn.md'].includes(path),
  outgoing: (path) =>
    path === 'Plan.md'
      ? [
          { target: 'Mara Quill', heading: null, alias: null, resolved: 'Mara Quill.md' },
          { target: 'Budget', heading: null, alias: null, resolved: null },
        ]
      : path === 'Mara Quill.md'
        ? [{ target: 'Plan', heading: null, alias: null, resolved: 'Plan.md' }]
        : [],
  backlinks: (path) => (path === 'Plan.md' ? ['Mara Quill.md', 'Tobias Fenn.md'] : []),
  tagsOf: (path) => (path === 'Plan.md' ? [{ key: 'project', name: 'project' }] : []),
  notesWithTag: () => ['Plan.md'],
  tagCounts: () => [{ key: 'project', name: 'project', count: 1 }],
};

function setup(toggled: ReadonlyMap<string, boolean> = new Map()) {
  const tree = buildMindMap(
    source,
    { kind: 'note', path: 'Plan.md' },
    { toggled, shown: new Map() },
  ) as MapNode;
  const handlers = { onPress: vi.fn(), onFocusRoot: vi.fn(), onToggle: vi.fn() };
  const onEnter = vi.fn();
  render(
    <MapCanvas
      layout={layoutMindMap(tree)}
      looks={new Map()}
      handlers={handlers}
      onEnter={onEnter}
    />,
  );
  return { handlers, onEnter, tree };
}

const item = (name: string) => screen.getAllByRole('treeitem', { name })[0] as HTMLElement;

describe('the mind map canvas', () => {
  it('draws the root, its labeled branches and their notes, a ghost said as one', () => {
    setup();
    expect(item('Plan')).toHaveAttribute('aria-level', '1');
    expect(item('Links, 2')).toHaveAttribute('aria-expanded', 'true');
    expect(item('Backlinks, 2')).toBeInTheDocument();
    expect(item('Budget, no note yet')).toBeInTheDocument();
    expect(item('#project')).toBeInTheDocument();
  });

  it('opens a note on a click, expands on the expander, focuses on the button or a double-click', () => {
    const { handlers } = setup();
    const mara = item('Mara Quill');
    fireEvent.click(mara.querySelector('.mind-map__label') as Element);
    expect(handlers.onPress).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Mara Quill' }),
      expect.anything(),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand Mara Quill' })[0] as Element);
    expect(handlers.onToggle).toHaveBeenCalledWith(expect.objectContaining({ state: 'closed' }));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Focus the map on Mara Quill' })[0] as Element,
    );
    fireEvent.doubleClick(mara.querySelector('.mind-map__label') as Element);
    expect(handlers.onFocusRoot).toHaveBeenCalledTimes(2);
  });

  it('shows a note already on the path as a repeat, with no expander', () => {
    const links = new Map([['root\u001flinks\u001fnote:Mara Quill.md', true]]);
    setup(links);
    expect(item('Plan, already on the map')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand Plan' })).toBeNull();
  });

  it('walks with the arrows, opens with Enter, toggles with Space, focuses with F', () => {
    const { handlers, onEnter } = setup();
    const root = item('Plan');
    root.focus();
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    expect(item('Links, 2')).toHaveFocus();
    fireEvent.keyDown(item('Links, 2'), { key: 'ArrowDown' });
    expect(item('Backlinks, 2')).toHaveFocus();
    fireEvent.keyDown(item('Backlinks, 2'), { key: 'ArrowRight' });
    const mara = document.activeElement as HTMLElement;
    expect(mara.getAttribute('aria-label')).toBe('Mara Quill');
    expect(mara.getAttribute('aria-level')).toBe('3');
    fireEvent.keyDown(mara, { key: 'Enter' });
    expect(onEnter).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mara Quill' }));
    fireEvent.keyDown(mara, { key: ' ' });
    expect(handlers.onToggle).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Mara Quill' }),
    );
    fireEvent.keyDown(mara, { key: 'f' });
    expect(handlers.onFocusRoot).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Mara Quill' }),
    );
    fireEvent.keyDown(mara, { key: 'ArrowLeft' });
    expect(item('Backlinks, 2')).toHaveFocus();
  });
});

describe('the map viewport', () => {
  const bounds = { left: 0, top: -100, right: 400, bottom: 100 };

  it('fits a small map at life size, root center-left, centered top to bottom', () => {
    expect(fitMap(bounds, { width: 1000, height: 600 })).toEqual({ x: 32, y: 300, k: 1 });
  });

  it('shrinks a big map no further than legible, then centers on the root', () => {
    const big = { left: 0, top: -2000, right: 400, bottom: 2000 };
    expect(fitMap(big, { width: 1000, height: 600 })).toEqual({ x: 32, y: 300, k: 0.5 });
  });

  it('pans only as far as needed to show a box', () => {
    const view = { x: 0, y: 0, k: 1 };
    const size = { width: 500, height: 500 };
    expect(panToShow(view, { left: 100, top: 100, right: 200, bottom: 120 }, size)).toBe(view);
    expect(panToShow(view, { left: 500, top: 100, right: 600, bottom: 120 }, size)).toEqual({
      x: -132,
      y: 0,
      k: 1,
    });
  });

  it('zooms about a point, keeping it in place', () => {
    const zoomed = zoomAbout({ x: 0, y: 0, k: 1 }, { x: 100, y: 100 }, 2);
    expect(zoomed).toEqual({ x: -100, y: -100, k: 2 });
  });
});
