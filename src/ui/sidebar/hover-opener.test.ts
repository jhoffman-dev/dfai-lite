import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hoverOpener, OPEN_AFTER_MS } from './hover-opener.ts';

describe('a closed folder a drag rests on', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits a whole second', () => {
    expect(OPEN_AFTER_MS).toBe(1000);
  });

  it('opens after the wait on that one folder, however many times the drag is heard over it', () => {
    const open = vi.fn();
    const opener = hoverOpener(open);
    opener.hover('Projects');
    vi.advanceTimersByTime(500);
    opener.hover('Projects');
    vi.advanceTimersByTime(OPEN_AFTER_MS - 501);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledExactlyOnceWith('Projects');
  });

  it('does not open once the drag moves on to another folder, which starts its own wait', () => {
    const open = vi.fn();
    const opener = hoverOpener(open);
    opener.hover('Areas');
    vi.advanceTimersByTime(900);
    opener.hover('Projects');
    vi.advanceTimersByTime(900);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(open).toHaveBeenCalledExactlyOnceWith('Projects');
  });

  it('does not open once the drag is over anything else, an open folder included', () => {
    const open = vi.fn();
    const opener = hoverOpener(open);
    opener.hover('Areas');
    vi.advanceTimersByTime(600);
    opener.hover(null);
    vi.advanceTimersByTime(OPEN_AFTER_MS * 2);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not open when the drag ends first', () => {
    const open = vi.fn();
    const opener = hoverOpener(open);
    opener.hover('Areas');
    opener.cancel();
    vi.advanceTimersByTime(OPEN_AFTER_MS * 2);
    expect(open).not.toHaveBeenCalled();
  });
});
