import type { VaultPath } from '../../domain/vault/index.ts';

/** How long a drag must rest on one closed folder before it opens. */
export const OPEN_AFTER_MS = 1000;

/** The timer functions the opener runs on: the window's, or a test's fake ones. */
export interface OpenerTimers {
  readonly set: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clear: (timer: ReturnType<typeof setTimeout>) => void;
}

const WINDOW_TIMERS: OpenerTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (timer) => clearTimeout(timer),
};

/**
 * Opens a closed folder once a drag has rested on that same folder for
 * `OPEN_AFTER_MS`. Held over anything else — another row, an open folder,
 * the space around the rows — the wait is dropped, so only the folder under
 * the pointer ever opens, and its rows appear below it, never above.
 */
export function hoverOpener(open: (folder: VaultPath) => void, timers = WINDOW_TIMERS) {
  let waiting: { folder: VaultPath; timer: ReturnType<typeof setTimeout> } | null = null;
  const cancel = () => {
    if (waiting !== null) timers.clear(waiting.timer);
    waiting = null;
  };
  return {
    /** The drag is over `folder`, a closed folder, or over anything else (null). */
    hover(folder: VaultPath | null) {
      if (folder !== null && waiting?.folder === folder) return;
      cancel();
      if (folder === null) return;
      const timer = timers.set(() => {
        waiting = null;
        open(folder);
      }, OPEN_AFTER_MS);
      waiting = { folder, timer };
    },
    cancel,
  };
}
