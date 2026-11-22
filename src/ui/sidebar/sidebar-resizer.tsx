import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { keyFor } from '../shell/shortcuts.ts';
import { useKeyHost } from '../shell/use-shortcuts.ts';
import { useUi } from '../state/ui-store.ts';
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_KEY_STEP,
} from './sidebar-width.ts';
import './sidebar-resize.css';

/** While the edge is dragged: no text selects, and the cursor stays col-resize everywhere. */
const RESIZING = 'is-resizing-sidebar';

/**
 * The sidebar's right edge: drag it, or focus it and use ←/→ (Home and End
 * go to the limits); a double click puts back the default. While dragging
 * only the frame's CSS variable moves; the width is kept once, on release.
 */
export function SidebarResizer() {
  const { actions } = useApp();
  const width = useUi((state) => state.sidebarWidth) ?? DEFAULT_SIDEBAR_WIDTH;
  const dragging = useRef(false);

  const widthAt = (event: PointerEvent<HTMLDivElement>) => clampSidebarWidth(event.clientX);
  const stop = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    document.documentElement.classList.remove(RESIZING);
    actions.setSidebar({ width: widthAt(event) });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const next: Record<string, number> = {
      ArrowLeft: width - SIDEBAR_KEY_STEP,
      ArrowRight: width + SIDEBAR_KEY_STEP,
      Home: MIN_SIDEBAR_WIDTH,
      End: MAX_SIDEBAR_WIDTH,
    };
    const value = next[event.key];
    if (value === undefined) return;
    event.preventDefault();
    actions.setSidebar({ width: clampSidebarWidth(value) });
  };

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize; double-click for the default width"
      onKeyDown={onKeyDown}
      onDoubleClick={() => actions.setSidebar({ width: null })}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // No text selection starts under a drag.
        event.preventDefault();
        dragging.current = true;
        document.documentElement.classList.add(RESIZING);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        const frame = event.currentTarget.closest<HTMLElement>('.app');
        frame?.style.setProperty('--sidebar-width', `${widthAt(event)}px`);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    />
  );
}

/** Brings a put-away sidebar back: the one thing on screen that says where it went. */
export function SidebarReveal() {
  const { actions } = useApp();
  const host = useKeyHost();
  return (
    <button
      type="button"
      className="quiet-button sidebar-reveal"
      aria-label="Show the sidebar"
      title={`Show the sidebar (${keyFor('sidebar.toggle', host)})`}
      onClick={() => actions.setSidebar({ collapsed: false })}
    >
      <Icon name="sidebar" />
    </button>
  );
}
