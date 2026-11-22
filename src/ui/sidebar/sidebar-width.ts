/** The sidebar's width when none was dragged, as `theme.css` sets `--sidebar-width`. */
export const DEFAULT_SIDEBAR_WIDTH = 256;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;
/** How far one arrow key moves the edge. */
export const SIDEBAR_KEY_STEP = 16;

/** A width the sidebar can take: whole pixels, between the limits. */
export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)));
}

/** The frame's inline style: the width kept on this device, or none for the theme's. */
export function sidebarWidthStyle(width: number | null): Record<string, string> {
  return width === null ? {} : { '--sidebar-width': `${clampSidebarWidth(width)}px` };
}
