import { VaultIndex } from '../index/index.ts';
import {
  buildMindMap,
  columnX,
  DEFAULT_MAP_OPTIONS,
  EMPTY_MAP_VIEW,
  entitiesTo,
  focusTrail,
  isTranscript,
  layoutMindMap,
  ROOT_ID,
  showMore,
  stepOnMap,
  toggleNode,
  trailAt,
  type MapNode,
  type MapView,
} from './index.ts';

const vault = () =>
  VaultIndex.build([
    {
      path: 'Projects/Larkspur Payroll.md',
      text: 'Run by [[Mara Quill]] with [[Tobias Fenn]]. See [[Budget]] and [[Mara Quill|Mara]]. #project/active #payroll',
    },
    { path: 'People/Mara Quill.md', text: 'Leads [[Larkspur Payroll]]. #person' },
    { path: 'People/Tobias Fenn.md', text: 'Works with [[Mara Quill]]. #person' },
    { path: 'Inbox/idea.md', text: 'Ask about [[Larkspur Payroll]]. #Project' },
    {
      path: 'Transcripts/2026-11-14 Kickoff (transcript).md',
      text: 'Everything said about [[Larkspur Payroll]].',
    },
    { path: 'Meetings/Kickoff (Transcript).md', text: '[[Larkspur Payroll]]' },
    { path: 'Lonely.md', text: 'Nothing here.' },
  ]);

const titles = (node: MapNode | undefined) => node?.children.map((child) => child.title) ?? [];
const branch = (node: MapNode | null, title: string) =>
  node?.children.find((child) => child.title === title);

describe('the mind map tree', () => {
  it('groups a note’s children into links, backlinks and tags, alphabetical, each once', () => {
    const map = buildMindMap(vault(), { kind: 'note', path: 'Projects/Larkspur Payroll.md' });
    expect(map?.state).toBe('open');
    expect(titles(map ?? undefined)).toEqual(['Links', 'Backlinks', 'Tags']);
    expect(titles(branch(map, 'Links'))).toEqual(['Budget', 'Mara Quill', 'Tobias Fenn']);
    expect(titles(branch(map, 'Backlinks'))).toEqual(['idea', 'Mara Quill']);
    expect(titles(branch(map, 'Tags'))).toEqual(['#payroll', '#project/active']);
    expect(branch(map, 'Backlinks')?.item).toEqual({
      kind: 'branch',
      branch: 'backlinks',
      total: 2,
    });
  });

  it('shows an unresolved link as a ghost leaf', () => {
    const map = buildMindMap(vault(), { kind: 'note', path: 'Projects/Larkspur Payroll.md' });
    const budget = branch(map, 'Links')?.children[0];
    expect(budget?.item).toEqual({
      kind: 'entity',
      entity: { kind: 'ghost', key: 'budget', target: 'Budget' },
    });
    expect(budget?.state).toBe('leaf');
  });

  it('leaves transcripts out by default, and shows them when asked', () => {
    const root = { kind: 'note', path: 'Projects/Larkspur Payroll.md' } as const;
    expect(titles(branch(buildMindMap(vault(), root), 'Backlinks'))).not.toContain(
      '2026-11-14 Kickoff (transcript)',
    );
    const all = buildMindMap(vault(), root, EMPTY_MAP_VIEW, {
      ...DEFAULT_MAP_OPTIONS,
      transcripts: true,
    });
    expect(titles(branch(all, 'Backlinks'))).toEqual([
      '2026-11-14 Kickoff (transcript)',
      'idea',
      'Kickoff (Transcript)',
      'Mara Quill',
    ]);
  });

  it('tells a transcript by its folder or its name', () => {
    expect(isTranscript('Transcripts/Anything.md')).toBe(true);
    expect(isTranscript('Meetings/2026/11/Sync (transcript).md')).toBe(true);
    expect(isTranscript('Meetings/2026/11/Sync.md')).toBe(false);
  });

  it('keeps a note shut until opened, then loads one level', () => {
    const index = vault();
    const root = { kind: 'note', path: 'Projects/Larkspur Payroll.md' } as const;
    const map = buildMindMap(index, root);
    const mara = branch(map, 'Links')?.children[1] as MapNode;
    expect(mara.state).toBe('closed');
    expect(mara.children).toEqual([]);
    const opened = buildMindMap(index, root, toggleNode(EMPTY_MAP_VIEW, mara));
    const again = branch(opened, 'Links')?.children[1];
    expect(again?.state).toBe('open');
    expect(titles(again)).toEqual(['Links', 'Backlinks', 'Tags']);
  });

  it('marks a note already on the path as a repeat, never expanded again', () => {
    const index = vault();
    const root = { kind: 'note', path: 'Projects/Larkspur Payroll.md' } as const;
    const mara = branch(buildMindMap(index, root), 'Links')?.children[1] as MapNode;
    const opened = buildMindMap(index, root, toggleNode(EMPTY_MAP_VIEW, mara));
    const back = branch(branch(opened, 'Links')?.children[1] ?? null, 'Links')?.children[0];
    expect(back?.title).toBe('Larkspur Payroll');
    expect(back?.state).toBe('repeat');
  });

  it('marks a note with nothing linked as a leaf', () => {
    const map = buildMindMap(vault(), { kind: 'note', path: 'Lonely.md' });
    expect(map?.state).toBe('leaf');
  });

  it('stops opening at the depth limit', () => {
    const map = buildMindMap(
      vault(),
      { kind: 'note', path: 'Projects/Larkspur Payroll.md' },
      EMPTY_MAP_VIEW,
      { ...DEFAULT_MAP_OPTIONS, maxDepth: 1 },
    );
    expect(branch(map, 'Links')?.children[1]?.state).toBe('limit');
  });

  it('caps a branch with a "more" node, and shows another cap’s worth on asking', () => {
    const many = VaultIndex.build([
      { path: 'Hub.md', text: 'The hub.' },
      ...Array.from({ length: 7 }, (_, at) => ({ path: `N${at}.md`, text: '[[Hub]]' })),
    ]);
    const options = { ...DEFAULT_MAP_OPTIONS, cap: 3 };
    const root = { kind: 'note', path: 'Hub.md' } as const;
    const capped = branch(buildMindMap(many, root, EMPTY_MAP_VIEW, options), 'Backlinks');
    expect(titles(capped)).toEqual(['N0', 'N1', 'N2', '4 more']);
    expect(capped?.item).toEqual({ kind: 'branch', branch: 'backlinks', total: 7 });
    const more = capped?.children[3] as MapNode;
    expect(more.item).toEqual({ kind: 'more', branch: 'backlinks', hidden: 4 });
    const view = showMore(EMPTY_MAP_VIEW, more.id, 3);
    const wider = branch(buildMindMap(many, root, view, options), 'Backlinks');
    expect(titles(wider)).toEqual(['N0', 'N1', 'N2', 'N3', 'N4', 'N5', '1 more']);
  });

  it('roots on a tag: nested tags and its own notes', () => {
    const map = buildMindMap(vault(), { kind: 'tag', key: 'project' });
    expect(map?.title).toBe('#Project');
    expect(titles(map ?? undefined)).toEqual(['Nested tags', 'Notes']);
    expect(titles(branch(map, 'Nested tags'))).toEqual(['#project/active']);
    expect(titles(branch(map, 'Notes'))).toEqual(['idea']);
  });

  it('roots on a parent tag never written alone', () => {
    const index = VaultIndex.build([{ path: 'A.md', text: '#Area/Work/Deep' }]);
    const map = buildMindMap(index, { kind: 'tag', key: 'area' });
    expect(map?.title).toBe('#Area');
    expect(titles(branch(map, 'Nested tags'))).toEqual(['#Area/Work']);
  });

  it('is null for a root that is gone', () => {
    expect(buildMindMap(vault(), { kind: 'note', path: 'Gone.md' })).toBeNull();
    expect(buildMindMap(vault(), { kind: 'tag', key: 'nothing' })).toBeNull();
  });

  it('shuts and reopens a branch', () => {
    const index = vault();
    const root = { kind: 'note', path: 'Projects/Larkspur Payroll.md' } as const;
    const links = branch(buildMindMap(index, root), 'Links') as MapNode;
    const view: MapView = toggleNode(EMPTY_MAP_VIEW, links);
    const shut = branch(buildMindMap(index, root, view), 'Links') as MapNode;
    expect(shut.state).toBe('closed');
    expect(shut.children).toEqual([]);
    const reopened = branch(buildMindMap(index, root, toggleNode(view, shut)), 'Links');
    expect(reopened?.children.length).toBe(3);
  });
});

describe('the mind map layout', () => {
  const metrics = { row: 10, branchGap: 4, entityColumn: 100, branchColumn: 50 };

  it('alternates note and branch columns', () => {
    expect([0, 1, 2, 3, 4].map((depth) => columnX(depth, metrics))).toEqual([
      0, 100, 150, 250, 300,
    ]);
  });

  it('gives each leaf its own row and centers parents on their children, root on zero', () => {
    const map = buildMindMap(vault(), { kind: 'note', path: 'Projects/Larkspur Payroll.md' });
    const { nodes, bounds } = layoutMindMap(map as MapNode, metrics);
    const root = nodes[0];
    expect(root?.node.id).toBe(ROOT_ID);
    expect(root?.y).toBe(0);
    const leaves = nodes.filter((node) => node.node.children.length === 0);
    const ys = leaves.map((leaf) => leaf.y);
    expect(ys).toEqual([...ys].sort((left, right) => left - right));
    for (let at = 1; at < ys.length; at += 1) {
      expect((ys[at] as number) - (ys[at - 1] as number)).toBeGreaterThanOrEqual(metrics.row);
    }
    for (const parent of nodes.filter((node) => node.node.children.length > 0)) {
      const kids = nodes.filter((node) => node.parentId === parent.node.id);
      expect(parent.y).toBe(((kids[0]?.y ?? 0) + (kids.at(-1)?.y ?? 0)) / 2);
    }
    expect(bounds.top).toBeLessThan(0);
    expect(bounds.bottom).toBeGreaterThan(0);
    expect(bounds.right).toBe(columnX(3, metrics));
  });

  it('lays out the same tree the same way', () => {
    const map = buildMindMap(vault(), { kind: 'tag', key: 'person' }) as MapNode;
    expect(layoutMindMap(map, metrics)).toEqual(layoutMindMap(map, metrics));
  });
});

describe('walking the map', () => {
  const index = vault();
  const root = { kind: 'note', path: 'Projects/Larkspur Payroll.md' } as const;
  const { nodes } = layoutMindMap(buildMindMap(index, root) as MapNode);
  const idOf = (title: string, parent?: string) =>
    nodes.find(
      (node) =>
        node.node.title === title &&
        (parent === undefined ||
          nodes.find((p) => p.node.id === node.parentId)?.node.title === parent),
    )?.node.id as string;

  it('moves between parent, first child and siblings with the arrows', () => {
    const links = idOf('Links');
    expect(stepOnMap(nodes, ROOT_ID, 'child')).toBe(links);
    expect(stepOnMap(nodes, links, 'parent')).toBe(ROOT_ID);
    expect(stepOnMap(nodes, links, 'next')).toBe(idOf('Backlinks'));
    expect(stepOnMap(nodes, links, 'previous')).toBe(links);
    expect(stepOnMap(nodes, ROOT_ID, 'parent')).toBe(ROOT_ID);
    expect(stepOnMap(nodes, idOf('Budget'), 'child')).toBe(idOf('Budget'));
  });

  it('lists the notes from the root to a node, for Focus', () => {
    const mara = idOf('Mara Quill', 'Links');
    expect(entitiesTo(nodes, mara)).toEqual([root, { kind: 'note', path: 'People/Mara Quill.md' }]);
  });

  it('keeps a trail of roots: Focus walks on, a known root steps along it', () => {
    const mara = { kind: 'note', path: 'People/Mara Quill.md' } as const;
    const tag = { kind: 'tag', key: 'person' } as const;
    let trail = trailAt(null, root);
    expect(trail).toEqual({ roots: [root], at: 0 });
    trail = focusTrail(trail, [root, mara]);
    expect(trail).toEqual({ roots: [root, mara], at: 1 });
    trail = focusTrail(trail, [mara, { kind: 'tag', key: 'person', name: 'person' }]);
    expect(trail).toEqual({ roots: [root, mara, tag], at: 2 });
    trail = trailAt(trail, root);
    expect(trail).toEqual({ roots: [root, mara, tag], at: 0 });
    expect(focusTrail(trail, [root, mara])).toEqual({ roots: [root, mara], at: 1 });
    expect(trailAt(trail, { kind: 'note', path: 'Lonely.md' })).toEqual({
      roots: [{ kind: 'note', path: 'Lonely.md' }],
      at: 0,
    });
  });

  it('never focuses on a ghost', () => {
    const trail = trailAt(null, root);
    expect(focusTrail(trail, [root, { kind: 'ghost', key: 'budget', target: 'Budget' }])).toBe(
      trail,
    );
  });
});
