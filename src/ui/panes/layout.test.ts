import {
  activate,
  closeMissingNotes,
  closeOthers,
  closeTab,
  currentTab,
  cycleTab,
  dropOnPane,
  initialLayout,
  jumpToTab,
  moveTab,
  moveToOtherPane,
  openView,
  restoreLayout,
  retargetNote,
  setSplit,
  shiftTab,
  splitRight,
  stepTab,
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
  return openView(layout, { view: note(path), openIn, source: false, canSplit });
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
  it('focuses the neighbor to the right, else the left', () => {
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
  it('shifts the active tab left or right in its pane, stopping at the ends', () => {
    const three = open(open(open(initialLayout(), PLAN), MARA, 'new-tab'), SHED, 'new-tab');
    const left = shiftTab(three, -1);
    expect(shape(left)).toEqual([[PLAN, `*${SHED}`, MARA]]);
    expect(shape(shiftTab(shiftTab(left, -1), -1))).toEqual([[`*${SHED}`, PLAN, MARA]]);
    expect(shiftTab(three, 1)).toBe(three);
  });
});

describe('dropping a tab on a pane', () => {
  it('moves it to the end of the other pane', () => {
    const two = open(open(initialLayout(), PLAN), MARA, 'new-tab');
    const split = open(two, SHED, 'side');
    const mara = split.panes[0]?.tabs[1]?.id ?? '';
    const layout = dropOnPane(split, { tabId: mara, toPane: 1, side: 'left' });
    expect(shape(layout)).toEqual([[`*${PLAN}`], [SHED, `*${MARA}`]]);
    expect(dropOnPane(split, { tabId: mara, toPane: 0, side: 'right' })).toBe(split);
  });

  it('splits when dropped on the right half of a single pane, not the left', () => {
    const two = open(open(initialLayout(), PLAN), MARA, 'new-tab');
    const mara = currentTab(two).id;
    expect(shape(dropOnPane(two, { tabId: mara, toPane: 0, side: 'right' }))).toEqual([
      [`*${PLAN}`],
      [`*${MARA}`],
    ]);
    expect(dropOnPane(two, { tabId: mara, toPane: 0, side: 'left' })).toBe(two);
  });

  it('shows the only tab on both sides rather than empty the left pane', () => {
    const one = open(initialLayout(), PLAN);
    const layout = dropOnPane(one, { tabId: currentTab(one).id, toPane: 0, side: 'right' });
    expect(shape(layout)).toEqual([[`*${PLAN}`], [`*${PLAN}`]]);
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
      source: false,
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

describe('each tab’s Back and Forward', () => {
  const backOf = (layout: Layout, tabId: string) =>
    layout.panes
      .flatMap((pane) => pane.tabs)
      .find((tab) => tab.id === tabId)
      ?.back.map((view) => (view.kind === 'note' ? view.path : view.kind));
  const activeId = (layout: Layout) => currentTab(layout).id;

  it('an open in the active tab is a step Back undoes, and Forward redoes', () => {
    const layout = open(open(initialLayout(), PLAN), MARA);
    const back = stepTab(layout, activeId(layout), 'back');
    expect(shape(back)).toEqual([[`*${PLAN}`]]);
    expect(shape(stepTab(back, activeId(back), 'forward'))).toEqual([[`*${MARA}`]]);
  });

  it('keeps each tab’s own: a new tab starts empty, and stepping one leaves the other', () => {
    const first = open(open(initialLayout(), PLAN), MARA);
    const both = open(open(first, SHED, 'new-tab'), PLAN);
    const firstId = first.panes[0]?.activeTab ?? '';
    expect(backOf(both, firstId)).toEqual([PLAN]);
    expect(backOf(both, activeId(both))).toEqual([SHED]);
    const stepped = stepTab(both, firstId, 'back');
    expect(shape(stepped)).toEqual([[`*${PLAN}`, PLAN]]);
    expect(backOf(stepped, activeId(both))).toEqual([SHED]);
  });

  it('focusing a tab that already shows the note is not a step', () => {
    const two = open(open(open(initialLayout(), PLAN), MARA, 'new-tab'), PLAN);
    expect(two.panes[0]?.tabs.every((tab) => tab.back.length === 0)).toBe(true);
  });

  it('steps the tab it is asked to, and focuses its pane', () => {
    const split = open(open(open(initialLayout(), PLAN), MARA), SHED, 'side');
    const leftId = split.panes[0]?.activeTab ?? '';
    const stepped = stepTab(split, leftId, 'back');
    expect(shape(stepped)).toEqual([[`*${PLAN}`], [`*${SHED}`]]);
    expect(stepped.activePane).toBe(0);
    expect(stepTab(split, activeId(split), 'back')).toBe(split);
  });

  it('goes with a tab moved to the other pane', () => {
    const layout = open(open(open(initialLayout(), PLAN), MARA), SHED, 'new-tab');
    const moved = moveToOtherPane(layout, layout.panes[0]?.tabs[0]?.id ?? '');
    expect(backOf(moved, moved.panes[1]?.activeTab ?? '')).toEqual([PLAN]);
  });

  it('follows a rename, and a deleted note’s tab goes back instead of closing', () => {
    const layout = open(open(open(initialLayout(), PLAN), MARA), SHED);
    const renamed = retargetNote(layout, PLAN, 'Projects/Payroll.md');
    expect(backOf(renamed, activeId(renamed))).toEqual(['Projects/Payroll.md', MARA]);
    const deleted = closeMissingNotes(renamed, (path) => path !== SHED);
    expect(shape(deleted)).toEqual([[`*${MARA}`]]);
    expect(backOf(deleted, activeId(deleted))).toEqual(['Projects/Payroll.md']);
  });

  it('is saved and restored with the layout, notes gone since skipped', () => {
    const layout = open(open(open(initialLayout(), PLAN), MARA), SHED);
    const raw: unknown = JSON.parse(JSON.stringify(layout));
    expect(restoreLayout(raw, () => true)).toEqual(layout);
    const restored = restoreLayout(raw, (path) => path !== MARA);
    expect(restored === null ? null : backOf(restored, 't1')).toEqual([PLAN]);
  });

  it('restores a saved history bounded, skipping places it cannot read', () => {
    const many = Array.from({ length: 60 }, (_, at) => ({ kind: 'note', path: `N${at}.md` }));
    const raw = {
      panes: [
        {
          tabs: [
            {
              id: 't1',
              view: { kind: 'graph' },
              back: [{ kind: 'table' }, 'tags', ...many],
              forward: { kind: 'note' },
            },
          ],
          activeTab: 't1',
        },
      ],
    };
    const tab = restoreLayout(raw, () => true)?.panes[0]?.tabs[0];
    expect(tab?.back).toHaveLength(50);
    expect(tab?.back[0]).toEqual({ kind: 'note', path: 'N10.md' });
    expect(tab?.forward).toEqual([]);
  });
});

describe('opening in the other pane (a map beside a note)', () => {
  it('splits when there is one pane, then follows links in the other pane’s open tab', () => {
    const split = open(open(initialLayout(), PLAN), MARA, 'other-pane');
    expect(shape(split)).toEqual([[`*${PLAN}`], [`*${MARA}`]]);
    const back = open({ ...split, activePane: 1 }, SHED, 'other-pane');
    expect(shape(back)).toEqual([[`*${SHED}`], [`*${MARA}`]]);
    expect(back.activePane).toBe(0);
  });

  it('opens a new tab where the window cannot split', () => {
    const narrow = open(open(initialLayout(), PLAN), MARA, 'other-pane', false);
    expect(shape(narrow)).toEqual([[PLAN, `*${MARA}`]]);
  });

  it('keeps a mind map tab through a save and a restore', () => {
    const map: TabView = { kind: 'map', root: { kind: 'note', path: PLAN } };
    const layout = openView(initialLayout(), {
      view: map,
      openIn: 'active',
      source: false,
      canSplit: true,
    });
    const restored = restoreLayout(JSON.parse(JSON.stringify(layout)), () => true);
    expect(currentTab(restored as Layout).view).toEqual(map);
    const follows = restoreLayout(
      JSON.parse(
        JSON.stringify(
          openView(layout, {
            view: { kind: 'map', root: null },
            openIn: 'active',
            source: false,
            canSplit: true,
          }),
        ),
      ),
      () => true,
    );
    expect(currentTab(follows as Layout).view).toEqual({ kind: 'map', root: null });
  });

  it('follows a renamed note into its map, and closes the map of a deleted one', () => {
    const map: TabView = { kind: 'map', root: { kind: 'note', path: PLAN } };
    const layout = openView(open(initialLayout(), MARA), {
      view: map,
      openIn: 'new-tab',
      source: false,
      canSplit: true,
    });
    const renamed = retargetNote(layout, PLAN, SHED);
    expect(currentTab(renamed).view).toEqual({ kind: 'map', root: { kind: 'note', path: SHED } });
    const deleted = closeMissingNotes(layout, (path) => path !== PLAN);
    expect(shape(deleted)).toEqual([[`*${MARA}`]]);
  });
});
