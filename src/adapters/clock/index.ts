import type { Clock, SyncTimers } from '../../application/index.ts';

/** The device's clock. */
export const systemClock: Clock = { now: () => new Date() };

/** This Mac's time zone (`America/Los_Angeles`), which imported meetings' times are written on. */
export const systemTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The browser's timers, for the sync scheduler. */
export const systemTimers: SyncTimers = {
  after(ms, run) {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  },
};
