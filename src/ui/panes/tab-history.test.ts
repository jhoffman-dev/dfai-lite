import type { TabView } from './layout.ts';
import {
  HISTORY_LIMIT,
  destination,
  followRename,
  forgetMissing,
  step,
  visit,
  type TabHistory,
} from './tab-history.ts';

const PLAN = 'Projects/Larkspur Payroll.md';
const MARA = 'People/Mara Quill.md';
const SHED = 'Projects/Garden shed.md';
const note = (path: string): TabView => ({ kind: 'note', path });
const BLANK_TAB: TabHistory = { view: { kind: 'home' }, back: [], forward: [] };

/** A tab that opened each path in turn, from a blank tab. */
function walked(...paths: string[]): TabHistory {
  return paths.reduce((tab, path) => visit(tab, note(path)), BLANK_TAB);
}

const pathOf = (view: TabView | null) => (view?.kind === 'note' ? view.path : view?.kind);
const places = (tab: TabHistory) => ({
  back: tab.back.map(pathOf),
  view: pathOf(tab.view),
  forward: tab.forward.map(pathOf),
});

describe('a tab’s Back and Forward', () => {
  it('starts empty: the blank tab a note opened in is nowhere to go back to', () => {
    const tab = walked(PLAN);
    expect(places(tab)).toEqual({ back: [], view: PLAN, forward: [] });
    expect(destination(tab, 'back')).toBeNull();
  });

  it('pushes each open, and Back and Forward walk the steps', () => {
    const tab = walked(PLAN, MARA, SHED);
    expect(places(tab)).toEqual({ back: [PLAN, MARA], view: SHED, forward: [] });
    const back = step(step(tab, 'back'), 'back');
    expect(places(back)).toEqual({ back: [], view: PLAN, forward: [MARA, SHED] });
    expect(places(step(back, 'forward'))).toEqual({ back: [PLAN], view: MARA, forward: [SHED] });
  });

  it('forgets Forward on a new open, as a browser does', () => {
    const tab = visit(step(walked(PLAN, MARA), 'back'), note(SHED));
    expect(places(tab)).toEqual({ back: [PLAN], view: SHED, forward: [] });
  });

  it('is not a step to show what the tab already shows, nor to go where there is nothing', () => {
    const tab = walked(PLAN, MARA);
    expect(visit(tab, note(MARA))).toBe(tab);
    expect(step(tab, 'forward')).toBe(tab);
    expect(step(walked(PLAN), 'back')).toEqual(walked(PLAN));
  });

  it('remembers the last 50 places each way, the oldest forgotten first', () => {
    const paths = Array.from({ length: HISTORY_LIMIT + 5 }, (_, at) => `Note ${at}.md`);
    const tab = walked(...paths);
    expect(tab.back).toHaveLength(HISTORY_LIMIT);
    expect(pathOf(tab.back[0] ?? null)).toBe('Note 4.md');
    const rewound = Array.from({ length: HISTORY_LIMIT }, () => 0).reduce(
      (current) => step(current, 'back'),
      tab,
    );
    expect(pathOf(rewound.view)).toBe('Note 4.md');
    expect(rewound.forward).toHaveLength(HISTORY_LIMIT);
    expect(pathOf(destination(rewound, 'forward'))).toBe('Note 5.md');
  });

  it('keeps pages beside notes: the tags and the graph are places too', () => {
    const tab = visit(visit(walked(PLAN), { kind: 'tags', tag: 'payroll' }), { kind: 'graph' });
    expect(destination(tab, 'back')).toEqual({ kind: 'tags', tag: 'payroll' });
    expect(step(step(tab, 'back'), 'back').view).toEqual(note(PLAN));
  });

  it('follows a rename in every place it holds', () => {
    const tab = step(walked(PLAN, MARA, PLAN, SHED), 'back');
    const renamed = followRename(tab, PLAN, 'Projects/Payroll.md');
    expect(places(renamed)).toEqual({
      back: ['Projects/Payroll.md', MARA],
      view: 'Projects/Payroll.md',
      forward: [SHED],
    });
    expect(followRename(tab, 'Elsewhere.md', 'Moved.md')).toBe(tab);
  });

  it('forgets a deleted note, and joins the places it leaves side by side', () => {
    const tab = step(walked(PLAN, MARA, PLAN, SHED, MARA), 'back');
    const gone = forgetMissing(tab, (path) => path !== MARA);
    expect(gone === null ? null : places(gone)).toEqual({ back: [PLAN], view: SHED, forward: [] });
    expect(forgetMissing(tab, () => true)).toBe(tab);
  });

  it('goes back to the last place before a deleted note it shows, or has nothing left', () => {
    const tab = walked(PLAN, MARA, SHED);
    const gone = forgetMissing(tab, (path) => path !== SHED);
    expect(gone === null ? null : places(gone)).toEqual({ back: [PLAN], view: MARA, forward: [] });
    expect(forgetMissing(walked(SHED), (path) => path !== SHED)).toBeNull();
  });
});
