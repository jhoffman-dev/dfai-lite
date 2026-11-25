import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { noteTitle, type ResolvedAppearances } from '../../application/index.ts';
import type { MapRoot } from '../../domain/mind-map/index.ts';
import type { Pane, Tab, TabView } from '../panes/layout.ts';
import { LookGlyph } from '../appearance/look-glyph.tsx';
import { Icon, type IconName } from '../shell/icons.tsx';
import { draggedTabId, isTabDrag, startTabDrag } from './tab-drag.ts';
import './tabs.css';

export function tabTitle(view: TabView): string {
  switch (view.kind) {
    case 'note':
      return noteTitle(view.path);
    case 'tags':
      return view.tag === null ? 'Tags' : `#${view.tag}`;
    case 'graph':
      return 'Graph';
    case 'map':
      return mapTitle(view.root);
    case 'home':
      return 'New tab';
  }
}

/** A mind map's name: what it is drawn from, or that it follows the open note. */
export function mapTitle(root: MapRoot | null): string {
  return root === null ? 'Mind map' : `Map: ${rootTitle(root)}`;
}

/** A map's root as a crumb names it: the note's title, or the tag. */
export function rootTitle(root: MapRoot): string {
  return root.kind === 'note' ? noteTitle(root.path) : `#${root.key}`;
}

/** The glyph before a tab's title, as DFAI draws a page's. */
function tabGlyph(view: TabView): IconName {
  switch (view.kind) {
    case 'note':
      return 'doc';
    case 'tags':
      return 'tag';
    case 'graph':
      return 'graph';
    case 'map':
      return 'mind-map';
    case 'home':
      return 'plus';
  }
}

export const tabElementId = (tabId: string) => `tab-${tabId}`;
export const panelElementId = (paneIndex: number) => `tab-panel-${paneIndex}`;

export interface TabBarProps {
  readonly pane: Pane;
  readonly paneIndex: number;
  readonly onActivate: (tabId: string) => void;
  readonly onClose: (tabId: string) => void;
  readonly onMenu: (tabId: string, at: { x: number; y: number }) => void;
  /** A tab dropped at `index` of this pane (counted without the dragged tab). */
  readonly onMove: (move: { tabId: string; toPane: number; index: number }) => void;
  /** The notes' icons and tints, by path: a note's tab shows its own. */
  readonly looks?: ResolvedAppearances;
}

const NO_LOOKS: ResolvedAppearances = new Map();

/** Where a drop over `target` puts the dragged tab: before it, or after it past its middle. */
function dropIndex(tabs: readonly Tab[], dragged: string, target: string, after: boolean): number {
  const others = tabs.filter((tab) => tab.id !== dragged);
  const at = others.findIndex((tab) => tab.id === target);
  return at < 0 ? others.length : at + (after ? 1 : 0);
}

/**
 * A pane's tabs: an ARIA tablist with a roving tabindex. ←/→, Home and End
 * move between tabs (and show them), Delete closes one; a middle click
 * closes, a drag reorders or moves a tab to the other pane.
 */
export function TabBar({
  pane,
  paneIndex,
  onActivate,
  onClose,
  onMenu,
  onMove,
  looks = NO_LOOKS,
}: TabBarProps) {
  const list = useRef<HTMLDivElement>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);

  const focusTab = (tab: Tab | undefined) => {
    if (tab === undefined) return;
    onActivate(tab.id);
    list.current?.querySelector<HTMLElement>(`#${tabElementId(tab.id)}`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, at: number) => {
    const { tabs } = pane;
    const moves: Record<string, Tab | undefined> = {
      ArrowRight: tabs[(at + 1) % tabs.length],
      ArrowLeft: tabs[(at - 1 + tabs.length) % tabs.length],
      Home: tabs[0],
      End: tabs[tabs.length - 1],
    };
    const tab = tabs[at];
    if (event.key in moves) focusTab(moves[event.key]);
    else if (event.key === 'Delete' && tab !== undefined) onClose(tab.id);
    else if ((event.key === 'Enter' || event.key === ' ') && tab !== undefined) onActivate(tab.id);
    else return;
    event.preventDefault();
  };

  const onDragOver = (event: DragEvent, target: string | null) => {
    if (!isTabDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (target === null) return setDropAt(null);
    const box = event.currentTarget.getBoundingClientRect();
    setDropAt({ id: target, after: event.clientX > box.left + box.width / 2 });
  };

  const onDrop = (event: DragEvent) => {
    const dragged = draggedTabId(event.dataTransfer);
    if (dragged === '') return;
    event.preventDefault();
    event.stopPropagation();
    const index =
      dropAt === null
        ? pane.tabs.filter((tab) => tab.id !== dragged).length
        : dropIndex(pane.tabs, dragged, dropAt.id, dropAt.after);
    setDropAt(null);
    onMove({ tabId: dragged, toPane: paneIndex, index });
  };

  return (
    <div
      ref={list}
      className="tab-strip__tabs"
      role="tablist"
      aria-label={paneIndex === 0 ? 'Tabs' : 'Tabs, right pane'}
      onDragOver={(event) => onDragOver(event, null)}
      onDragLeave={() => setDropAt(null)}
      onDrop={onDrop}
    >
      {pane.tabs.map((tab, at) => {
        const selected = tab.id === pane.activeTab;
        const title = tabTitle(tab.view);
        const marker =
          dropAt?.id === tab.id ? (dropAt.after ? ' is-drop-after' : ' is-drop-before') : '';
        return (
          <div
            key={tab.id}
            id={tabElementId(tab.id)}
            className={`tab-strip__item${selected ? ' tab-strip__item--active' : ''}${marker}`}
            role="tab"
            aria-selected={selected}
            aria-controls={panelElementId(paneIndex)}
            tabIndex={selected ? 0 : -1}
            title={title}
            draggable
            onClick={() => onActivate(tab.id)}
            onMouseDown={(event: MouseEvent) => event.button === 1 && event.preventDefault()}
            onAuxClick={(event) => event.button === 1 && onClose(tab.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onMenu(tab.id, { x: event.clientX, y: event.clientY });
            }}
            onKeyDown={(event) => onKeyDown(event, at)}
            onDragStart={(event) => startTabDrag(event.dataTransfer, { tabId: tab.id, paneIndex })}
            onDragOver={(event) => {
              event.stopPropagation();
              onDragOver(event, tab.id);
            }}
          >
            <LookGlyph
              look={tab.view.kind === 'note' ? (looks.get(tab.view.path) ?? null) : null}
              fallback={tabGlyph(tab.view)}
            />
            <span className="tab-strip__title">{title}</span>
            <button
              type="button"
              className="tab-strip__close"
              tabIndex={-1}
              aria-label={`Close ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
