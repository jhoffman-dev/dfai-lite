import { fireEvent, render, screen } from '@testing-library/react';
import type { GraphNode, VaultGraph } from '../../domain/index/index.ts';
import { GraphView } from './index.ts';

const note = (id: string): GraphNode => ({
  id,
  kind: 'note',
  title: id.replace(/^.*\//, '').replace(/\.md$/, ''),
});

/** As `VaultIndex.graph()` gives it; the UI may use domain types only, so it is written out. */
const graph: VaultGraph = {
  nodes: [
    note('Inbox/Far away.md'),
    note('Inbox/Loose idea.md'),
    note('People/Mara Quill.md'),
    note('People/Tobias Fenn.md'),
    note('Projects/Larkspur rollout.md'),
    { id: 'ghost:larkspur payroll', kind: 'ghost', title: 'Larkspur Payroll' },
  ],
  edges: [
    { source: 'Inbox/Far away.md', target: 'People/Tobias Fenn.md' },
    { source: 'People/Mara Quill.md', target: 'Projects/Larkspur rollout.md' },
    { source: 'People/Tobias Fenn.md', target: 'People/Mara Quill.md' },
    { source: 'Projects/Larkspur rollout.md', target: 'ghost:larkspur payroll' },
  ],
};

const nodes = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-node]')].map(
    (node) => node.getAttribute('data-node') ?? '',
  );

function setup(activePath: string | null = 'Projects/Larkspur rollout.md', shown = graph) {
  const onOpenNote = vi.fn();
  const onFollowLink = vi.fn();
  const view = render(
    <GraphView
      graph={shown}
      activePath={activePath}
      onOpenNote={onOpenNote}
      onFollowLink={onFollowLink}
    />,
  );
  return { ...view, onOpenNote, onFollowLink };
}

/** A press and release on a node, without moving: a click, as the canvas reads one. */
function clickNode(container: HTMLElement, id: string, init: PointerEventInit = {}) {
  const node = container.querySelector(`[data-node="${id}"]`) as Element;
  fireEvent.pointerDown(node, { clientX: 10, clientY: 10, ...init });
  fireEvent.pointerUp(container.querySelector('svg') as Element, {
    clientX: 10,
    clientY: 10,
    ...init,
  });
}

const labels = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('.graph__label')].map((label) => label.textContent ?? '');

describe('GraphView', () => {
  it('draws a node per note, and a ghost for a link target with no note', () => {
    const { container } = setup();
    expect(nodes(container)).toHaveLength(6);
    expect(container.querySelectorAll('.graph__node--ghost')).toHaveLength(1);
    expect(container.querySelector('.graph__node--active')?.getAttribute('data-node')).toBe(
      'Projects/Larkspur rollout.md',
    );
  });

  it('opens a note when its node is clicked', () => {
    const { container, onOpenNote } = setup();
    clickNode(container, 'People/Mara Quill.md');
    expect(onOpenNote).toHaveBeenCalledWith('People/Mara Quill.md', 'active');
  });

  it('opens in a new tab on ⌘/Ctrl or middle click, and to the side on ⌥-click', () => {
    const { container, onOpenNote } = setup();
    clickNode(container, 'People/Mara Quill.md', { metaKey: true });
    clickNode(container, 'People/Mara Quill.md', { ctrlKey: true });
    clickNode(container, 'People/Mara Quill.md', { button: 1 });
    clickNode(container, 'People/Mara Quill.md', { altKey: true });
    expect(onOpenNote.mock.calls.map(([, openIn]) => openIn)).toEqual([
      'new-tab',
      'new-tab',
      'new-tab',
      'side',
    ]);
  });

  it('does not open a note on a right click', () => {
    const { container, onOpenNote } = setup();
    clickNode(container, 'People/Mara Quill.md', { button: 2 });
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('creates and opens the note a ghost stands for when it is clicked', () => {
    const { container, onOpenNote, onFollowLink } = setup();
    clickNode(container, 'ghost:larkspur payroll', { metaKey: true });
    expect(onFollowLink).toHaveBeenCalledWith('Larkspur Payroll', 'new-tab');
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('titles every note when there are few', () => {
    const { container } = setup();
    expect(labels(container).sort()).toEqual([
      'Far away',
      'Larkspur Payroll',
      'Larkspur rollout',
      'Loose idea',
      'Mara Quill',
      'Tobias Fenn',
    ]);
  });

  it('titles only the open note, and the one pointed at with its neighbours, when there are many', () => {
    const ids = Array.from({ length: 40 }, (_, at) => `N${at}.md`);
    const many: VaultGraph = {
      nodes: ids.map(note),
      edges: [
        { source: 'N1.md', target: 'N2.md' },
        { source: 'N3.md', target: 'N1.md' },
      ],
    };
    const { container } = setup('N0.md', many);
    expect(labels(container)).toEqual(['N0']);
    fireEvent.pointerEnter(container.querySelector('[data-node="N1.md"]') as Element);
    expect(labels(container).sort()).toEqual(['N0', 'N1', 'N2', 'N3']);
  });

  it('limits the local graph to the open note and its neighbours, one or two steps out', () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Local graph' }));
    expect(nodes(container).sort()).toEqual([
      'People/Mara Quill.md',
      'Projects/Larkspur rollout.md',
      'ghost:larkspur payroll',
    ]);
    fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '2' } });
    expect(nodes(container)).toContain('People/Tobias Fenn.md');
    expect(nodes(container)).not.toContain('Inbox/Far away.md');
  });

  it('cannot go local with no note open', () => {
    setup(null);
    expect(screen.getByRole('button', { name: 'Local graph' })).toBeDisabled();
  });

  it('narrows to the notes the filter matches', () => {
    const { container } = setup();
    fireEvent.change(screen.getByLabelText('Filter notes'), { target: { value: 'people/' } });
    expect(nodes(container).sort()).toEqual(['People/Mara Quill.md', 'People/Tobias Fenn.md']);
  });

  it('lists the same notes as buttons for the keyboard', () => {
    const { onOpenNote } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    const list = screen.getByRole('list', { name: 'Notes in the graph' });
    expect(list.querySelectorAll(':scope > li')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Loose idea' }));
    expect(onOpenNote).toHaveBeenCalledWith('Inbox/Loose idea.md', 'active');
  });

  it('creates the note a ghost stands for from the list too', () => {
    const { onFollowLink } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: /Larkspur Payroll \(no note yet\)/ }));
    expect(onFollowLink).toHaveBeenCalledWith('Larkspur Payroll', 'active');
  });

  it('draws only the most linked notes past the cap, and says so', () => {
    const ids = Array.from({ length: 650 }, (_, at) => `N${at}.md`);
    const many: VaultGraph = {
      nodes: ids.map(note),
      edges: ids.slice(1).map((source) => ({ source, target: 'N0.md' })),
    };
    setup(null, many);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing the 600 most linked notes; 50 more',
    );
  });
});
