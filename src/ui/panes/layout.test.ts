import {
  activate,
  closeMissingNotes,
  closeOthers,
  closeTab,
  currentTab,
  cycleTab,
  initialLayout,
  jumpToTab,
  moveTab,
  moveToOtherPane,
  openView,
  restoreLayout,
  retargetNote,
  setSplit,
  splitRight,
  toggleSplit,
  type Layout,
  type OpenIn,
  type TabView,
} from './layout.ts';

const PLAN = 'Projects/Larkspur Payroll.md';
const MARA = 'People/Mara Quill.md';
const SHED = 'Projects/Garden shed.md';
const note = (path: string): TabView => ({ kind: 'note', path });

function open(layout: Layout, path: string, openIn: OpenIn = 'active', canSplit = true): Layout {
  return openView(layout, { view: note(path), openIn, preview: false, canSplit });
}

/** What each pane shows, by note title-ish path, with the active tab marked `*`. */
function shape(layout: Layout): string[][] {
  return layout.panes.map((pane) =>
    pane.tabs.map((tab) => {
      const name = tab.view.kind === 'note' ? tab.view.path : tab.view.kind;
      return tab.id === pane.activeTab ? `*${name}` : name;
    }),
  );
}

describe('opening into the active tab', () => {
  it('replaces what the active tab shows', () => {
    const layout = open(open(initialLayout(), PLAN), MARA);
    expect(shape(layout)).toEqual([[`*${MARA}`]]);
  });

  it('focuses a tab of the active pane that already shows the note, instead of replacing', () => {
    const two = open(open(initialLayout(), PLAN), MARA, 'new-tab');
    const back = open(two, PLAN);
    expect(shape(back)).toEqual([[`*${PLAN}`, MARA]]);
  });

  it('does not look in the other pane for the note', () => {
    const split = open(open(initialLayout(), PLAN), MARA, 'side');
    const again = open(split, PLAN);
    expect(shape(again)).toEqual([[`*${PLAN}`], [`*${PLAN}`]]);
  });
});

describe('opening a new tab', () => {
  it('adds a tab right after the active one and focuses it', () => {
    const three = open(open(open(initialLayout(), PLAN), MARA, 'new-tab'), SHED, 'new-tab');
    const back = activate(three, three.panes[0]?.tabs[0]?.id ?? '');
    expect(shape(open(back, 'Welcome.md', 'new-tab'))).toEqual([[PLAN, '*Welcome.md', MARA, SHED]]);
  });

  it('reuses a blank active tab', () => {
    expect(shape(open(initialLayout(), PLAN, 'new-tab'))).toEqual([[`*${PLAN}`]]);
  });

  it('gives each tab its own id', () => {
    const layout = open(open(open(initialLayout(), PLAN), MARA, 'new-tab'), SHED, 'new-tab');
    const ids = layout.panes.flatMap((pane) => pane.tabs.map((tab) => tab.id));
    expect(new Set(ids).size).toBe(3);
  });
});

describe('opening to the side', () => {
  it('splits the window and opens the note in the new right pane', () => {
    const layout = open(open(initialLayout(), PLAN), MARA, 'side');
    expect(shape(layout)).toEqual([[`*${PLAN}`], [`*${MARA}`]]);
    expect(layout.activePane).toBe(1);
  });

  it('opens in a new tab of the other pane when already split, never a third pane', () => {
    const split = open(open(initialLayout(), PLAN), MARA, 'side');
    const back = activate(split, split.panes[0]?.activeTab ?? '');
    const layout = open(back, SHED, 'side');
    expect(shape(layout)).toEqual([[`*${PLAN}`], [MARA, `*${SHED}`]]);
    expect(layout.activePane).toBe(1);
  });

  it('focuses the other pane’s tab when it already shows the note', () => {
    const split = open(open(initialLayout(), PLAN), MARA, 'side');
    const back = activate(split, split.panes[0]?.activeTab ?? '');
    expect(shape(open(back, MARA, 'side'))).toEqual([[`*${PLAN}`], [`*${MARA}`]]);
  });

  it('opens a new tab instead on a phone-width window, where splitting is off', () => {
    const layout = open(open(initialLayout(), PLAN), MARA, 'side', false);
    expect(shape(layout)).toEqual([[PLAN, `*${MARA}`]]);
  });
});

describe('closing tabs', () => {
  it('focuses the neighbour to the right, else the left', () => {
    const three = open(open(open(initialLayout(), PLAN), MARA, 'new-tab'), SHED, 'new-tab');
    const middle = activate(three, three.panes[0]?.tabs[1]?.id ?? '');
    expect(shape(closeTab(middle, middle.panes[0]?.activeTab ?? ''))).toEqual([[PLAN, `*${SHED}`]]);
    const last = closeTab(three, three.panes[0]?.activeTab ?? '');
    expect(shape(last)).toEqual([[PLAN, `*${MARA}`]]);
  });

  it('closes the pane with its last tab, and the other pane takes focus', () => {
    const split = open(open(initialLayout(), PLAN), MARA, 'side');
    const layout = closeTab(split, split.panes[1]?.activeTab ?? '');
    expect(shape(layout)).toEqual([[`*${PLAN}`]]);
    expect(layout.activePane).toBe(0);
  });

  it('keeps the last pane, showing a blank tab, when its last tab closes', () => {
    const layout = open(initialLayout(), PLAN);
    expect(shape(closeTab(layout, currentTab(layout).id))).toEqual([['*home']]);
  });

  it('closes the other tabs of the pane, leaving the other pane alone', () => {
    const two = open(open(initialLayout(), PLAN), MARA, 'new-tab');
    const split = open(two, SHED, 'side');
    const layout = closeOthers(split, split.panes[0]?.tabs[0]?.id ?? '');
    expect(shape(layout)).toEqual([[`*${PLAN}`], [`*${SHED}`]]);
    expect(layout.activePane).toBe(0);
  });
});

describe('moving tabs', () => {
  it('reorders within a pane', () => {
    const three = open(open(open(initialLayout(), PLAN), MARA, 'new-tab'), SHED, 'new-tab');
    const last = three.panes[0]?.tabs[2]?.id ?? '';
    expect(shape(moveTab(three, { tabId: last, toPane: 0, index: 0 }))).toEqual([
      [`*${SHED}`, PLAN, MARA],
    ]);
  });

  it('moves a tab to the other pane, which takes focus', () => {
    const two = open(open(initialLayout(), PLAN), MARA, 'new-tab');
    const split = open(two, SHED, 'side');
    const mara = split.panes[0]?.tabs[1]?.id ?? '';
    const layout = moveTab(split, { tabId: mara, toPane: 1, index: 0 });
    expect(shape(layout)).toEqual([[`*${PLAN}`], [`*${MARA}`, SHED]]);
    expect(layout.activePane).toBe(1);
  });

  it('closes the pane a move empties', () => {
    const split = open(open(initialLayout(), PLAN), MARA, 'side');
    const layout = moveToOtherPane(split, split.panes[1]?.activeTab ?? '');
    expect(shape(layout)).toEqual([[PLAN, `*${MARA}`]]);
    expect(layout.activePane).toBe(0);
  });

  it('splits when moving one of several tabs out of a single pane, but not the only one', () => {
    const two = open(open(initialLayout(), PLAN), MARA, 'new-tab');
    expect(shape(moveToOtherPane(two, currentTab(two).id))).toEqual([[`*${PLAN}`], [`*${MARA}`]]);
    const one = open(initialLayout(), PLAN);
    expect(moveToOtherPane(one, currentTab(one).id)).toBe(one);
  });
});

describe('split and focus', () => {
  it('splits right with a copy of the active tab, and stops at two panes', () => {
    const layout = splitRight(open(initialLayout(), PLAN));
    expect(shape(layout)).toEqual([[`*${PLAN}`], [`*${PLAN}`]]);
    expect(splitRight(layout)).toBe(layout);
  });

  it('unsplits with ⌘\\ only when the other pane shows nothing', () => {
    const split = splitRight(open(initialLayout(), PLAN));
    expect(toggleSplit(split)).toBe(split);
    const blank = openView(split, {
      view: { kind: 'home' },
      openIn: 'active',
      preview: false,
      canSplit: true,
    });
    expect(shape(toggleSplit(activate(blank, blank.panes[0]?.activeTab ?? '')))).toEqual([
      [`*${PLAN}`],
    ]);
  });

  it('cycles tabs with wrap-around, and ⌘9 jumps to the last', () => {
    const three = open(open(open(initialLayout(), PLAN), MARA, 'new-tab'), SHED, 'new-tab');
    expect(currentTab(cycleTab(three, 1)).view).toEqual(note(PLAN));
    expect(currentTab(cycleTab(three, -1)).view).toEqual(note(MARA));
    expect(currentTab(jumpToTab(three, 1)).view).toEqual(note(PLAN));
    expect(currentTab(jumpToTab(three, 9)).view).toEqual(note(SHED));
    expect(jumpToTab(three, 5)).toBe(three);
  });

  it('keeps the divider between a fifth and four fifths', () => {
    expect(setSplit(initialLayout(), 0.05).split).toBe(0.2);
    expect(setSplit(initialLayout(), 0.95).split).toBe(0.8);
    expect(setSplit(initialLayout(), Number.NaN).split).toBe(0.5);
  });
});

describe('following the vault', () => {
  it('points every tab on a renamed note at its new path', () => {
    const split = splitRight(open(initialLayout(), PLAN));
    expect(shape(retargetNote(split, PLAN, SHED))).toEqual([[`*${SHED}`], [`*${SHED}`]]);
  });

  it('closes the tabs of a deleted note, and the pane it empties', () => {
    const split = open(open(open(initialLayout(), PLAN), MARA, 'new-tab'), MARA, 'side');
    const layout = closeMissingNotes(split, (path) => path !== MARA);
    expect(shape(layout)).toEqual([[`*${PLAN}`]]);
  });
});

describe('restoring a saved layout', () => {
  const saved = (layout: Layout): unknown => JSON.parse(JSON.stringify(layout));

  it('brings back the panes, tabs, active ones and divider', () => {
    const layout = setSplit(
      open(open(open(initialLayout(), PLAN), MARA, 'new-tab'), SHED, 'side'),
      0.3,
    );
    expect(restoreLayout(saved(layout), () => true)).toEqual(layout);
  });

  it('drops tabs whose note no longer exists, and a pane left empty', () => {
    const layout = open(open(open(initialLayout(), PLAN), MARA, 'new-tab'), SHED, 'side');
    const restored = restoreLayout(saved(layout), (path) => path !== SHED && path !== MARA);
    expect(restored === null ? null : shape(restored)).toEqual([[`*${PLAN}`]]);
  });

  it('gives a blank tab when every note is gone', () => {
    const restored = restoreLayout(saved(open(initialLayout(), PLAN)), () => false);
    expect(restored === null ? null : shape(restored)).toEqual([['*home']]);
  });

  it('mints new ids after the restored ones', () => {
    const layout = open(open(initialLayout(), PLAN), MARA, 'new-tab');
    const restored = restoreLayout(saved(layout), () => true);
    const next = restored === null ? null : open(restored, SHED, 'new-tab');
    const ids = next?.panes[0]?.tabs.map((tab) => tab.id) ?? [];
    expect(new Set(ids).size).toBe(3);
  });

  it.each([
    ['nothing', null],
    ['not an object', 'tabs'],
    ['no panes', { panes: [] }],
    [
      'three panes',
      { panes: [1, 2, 3].map(() => ({ tabs: [{ id: 't1', view: { kind: 'home' } }] })) },
    ],
    ['a tab with no view', { panes: [{ tabs: [{ id: 't1' }], activeTab: 't1' }] }],
    [
      'an unknown view',
      { panes: [{ tabs: [{ id: 't1', view: { kind: 'table' } }], activeTab: 't1' }] },
    ],
    [
      'repeated ids',
      {
        panes: [
          { tabs: [1, 2].map(() => ({ id: 't1', view: { kind: 'graph' } })), activeTab: 't1' },
        ],
      },
    ],
  ])('starts fresh from %s', (_, raw) => {
    expect(restoreLayout(raw, () => true)).toBeNull();
  });

  it('falls back to the first tab when the saved active tab is not there', () => {
    const raw = { panes: [{ tabs: [{ id: 't4', view: { kind: 'graph' } }], activeTab: 't9' }] };
    expect(restoreLayout(raw, () => true)?.panes[0]?.activeTab).toBe('t4');
  });
});
