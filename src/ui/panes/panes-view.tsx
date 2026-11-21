import { useCallback, useState, type CSSProperties } from 'react';
import { GraphPage } from '../graph-page/graph-page.tsx';
import { NotePane } from '../note/note-pane.tsx';
import { useApp } from '../services.ts';
import { Home } from '../shell/home.tsx';
import { Icon } from '../shell/icons.tsx';
import { keyFor } from '../shell/shortcuts.ts';
import { RowMenu, type MenuItem } from '../sidebar/row-menu.tsx';
import { TabBar, panelElementId, tabElementId } from '../tabs/tab-bar.tsx';
import { TagsPage } from '../tags/tags-page.tsx';
import { Divider } from './divider.tsx';
import {
  BLANK,
  activate,
  activeTabOf,
  closeOthers,
  closeTab,
  focusPane,
  moveTab,
  moveToOtherPane,
  setSplit,
  splitRight,
  type Layout,
  type Tab,
} from './layout.ts';
import { useLayout } from './layout-store.ts';
import { useNarrow } from './narrow.ts';
import { usePaneDrop } from './use-pane-drop.ts';
import './panes.css';

/** The note the graph centres its local view on: the active pane's, else the other pane's. */
function graphFocus(layout: Layout): string | null {
  const order = [layout.activePane, layout.activePane === 0 ? 1 : 0];
  for (const index of order) {
    const pane = layout.panes[index];
    const view = pane === undefined ? null : activeTabOf(pane).view;
    if (view?.kind === 'note') return view.path;
  }
  return null;
}

function GraphTab() {
  return <GraphPage activePath={useLayout(graphFocus)} />;
}

function TabContent({ tab, focused }: { tab: Tab; focused: boolean }) {
  const { view } = tab;
  switch (view.kind) {
    case 'note':
      return (
        <NotePane key={`${tab.id}:${view.path}`} tab={tab} path={view.path} focused={focused} />
      );
    case 'tags':
      return <TagsPage tag={view.tag} />;
    case 'graph':
      return <GraphTab />;
    case 'home':
      return <Home />;
  }
}

interface MenuState {
  readonly tabId: string;
  readonly at: { readonly x: number; readonly y: number };
}

function useTabMenu(canSplit: boolean) {
  const { workspace, ui, layout } = useApp();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const items = (tabId: string): MenuItem[] => {
    const { preview } = ui.getState();
    const split = layout.getState().panes.length > 1;
    const arrange = workspace.arrange;
    return [
      { label: 'Close', run: () => arrange((current) => closeTab(current, tabId, { preview })) },
      { label: 'Close others', run: () => arrange((current) => closeOthers(current, tabId)) },
      ...(!canSplit
        ? []
        : split
          ? [
              {
                label: 'Move to other pane',
                run: () => arrange((current) => moveToOtherPane(current, tabId)),
              },
            ]
          : [
              { label: 'Split right', run: () => arrange((current) => splitRight(current, tabId)) },
            ]),
    ];
  };
  return { menu, setMenu, close, items };
}

/** One pane: its tab bar, and the active tab's content (the hidden tabs mount nothing). */
function PaneView({ index, canSplit }: { index: number; canSplit: boolean }) {
  const { workspace, ui } = useApp();
  const pane = useLayout((layout) => layout.panes[index]);
  const focused = useLayout((layout) => layout.activePane === index);
  const split = useLayout((layout) => layout.panes.length > 1);
  const { menu, setMenu, close, items } = useTabMenu(canSplit);
  const drop = usePaneDrop(index, canSplit);
  if (pane === undefined) return null;
  const tab = activeTabOf(pane);
  const arrange = workspace.arrange;
  const focusThis = () => {
    if (!focused) arrange((current) => focusPane(current, index));
  };

  return (
    <section
      className={`pane${focused ? ' is-focused' : ''}`}
      aria-label={index === 0 ? 'Left pane' : 'Right pane'}
      onPointerDownCapture={focusThis}
      onFocusCapture={focusThis}
    >
      <div className="pane-header">
        <TabBar
          pane={pane}
          paneIndex={index}
          onActivate={(tabId) => arrange((current) => activate(current, tabId))}
          onClose={(tabId) =>
            arrange((current) => closeTab(current, tabId, { preview: ui.getState().preview }))
          }
          onMenu={(tabId, at) => setMenu({ tabId, at })}
          onMove={(move) => arrange((current) => moveTab(current, move))}
        />
        <button
          type="button"
          className="quiet-button pane-action"
          aria-label="New tab"
          title={`New tab (${keyFor('tab.new')})`}
          onClick={() => {
            workspace.open(BLANK, 'new-tab', { replace: true });
            ui.setState({ paletteOpen: true });
          }}
        >
          <Icon name="plus" />
        </button>
        {canSplit && !split ? (
          <button
            type="button"
            className="quiet-button pane-action"
            aria-label="Split right"
            title={`Split right (${keyFor('pane.toggleSplit')})`}
            onClick={() => arrange((current) => splitRight(current))}
          >
            <Icon name="split" />
          </button>
        ) : null}
      </div>
      <div className="pane-body" {...drop.handlers}>
        <div
          className="pane-panel"
          id={panelElementId(index)}
          role="tabpanel"
          aria-labelledby={tabElementId(tab.id)}
        >
          <TabContent tab={tab} focused={focused} />
        </div>
        {drop.zone === null ? null : (
          <div className={`pane-drop is-${drop.zone}`} aria-hidden="true" />
        )}
      </div>
      {menu === null ? null : (
        <RowMenu label="Tab actions" at={menu.at} onClose={close} items={items(menu.tabId)} />
      )}
    </section>
  );
}

/** One pane, or two side by side with a divider; on a phone only the active one shows. */
export function PanesView() {
  const { workspace } = useApp();
  const narrow = useNarrow();
  const count = useLayout((layout) => layout.panes.length);
  const activePane = useLayout((layout) => layout.activePane);
  const split = useLayout((layout) => layout.split);
  const shown = narrow || count === 1 ? [narrow ? activePane : 0] : [0, 1];
  const style = { '--split': String(split) } as CSSProperties;

  return (
    <div className={`panes${shown.length > 1 ? ' is-split' : ''}`} style={style}>
      <PaneView key={shown[0]} index={shown[0] ?? 0} canSplit={!narrow} />
      {shown.length > 1 ? (
        <>
          <Divider
            split={split}
            onChange={(share) => workspace.arrange((current) => setSplit(current, share))}
          />
          <PaneView key={1} index={1} canSplit={!narrow} />
        </>
      ) : null}
    </div>
  );
}
