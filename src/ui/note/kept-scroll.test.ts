import { holdScrollWhileLoading } from './kept-scroll.ts';

/*
 * Going back to a note lands where it was left, though its pictures take no
 * room until they are read and drawn: the scroll is put back each time the
 * page grows, until the person scrolls on their own.
 */

/** A ResizeObserver fired by hand: `grow()` is the page getting taller. */
function handResizeObserver() {
  const callbacks: (() => void)[] = [];
  let disconnected = 0;
  class HandObserver {
    private readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      callbacks.push(callback);
    }
    observe() {}
    disconnect() {
      disconnected += 1;
      callbacks.splice(callbacks.indexOf(this.callback), 1);
    }
  }
  vi.stubGlobal('ResizeObserver', HandObserver);
  return {
    grow: () => callbacks.forEach((callback) => callback()),
    disconnects: () => disconnected,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function scrollerAt(top: number) {
  const scroller = document.createElement('div');
  scroller.scrollTop = top;
  return { scroller, page: document.createElement('article') };
}

describe('the scroll a tab goes back to', () => {
  it('is put back each time the page grows as its pictures load', () => {
    const hand = handResizeObserver();
    const { scroller, page } = scrollerAt(640);
    holdScrollWhileLoading({ page, scroller, top: 640 });
    // A picture above drew taller, and the browser kept the old offset short of it.
    scroller.scrollTop = 460;
    hand.grow();
    expect(scroller.scrollTop).toBe(640);
  });

  it('is let go the moment the person scrolls', () => {
    const hand = handResizeObserver();
    const { scroller, page } = scrollerAt(640);
    holdScrollWhileLoading({ page, scroller, top: 640 });
    scroller.dispatchEvent(new Event('wheel'));
    scroller.scrollTop = 100;
    hand.grow();
    expect(scroller.scrollTop).toBe(100);
    expect(hand.disconnects()).toBe(1);
  });

  it('holds nothing at the top of the page', () => {
    const hand = handResizeObserver();
    const { scroller, page } = scrollerAt(0);
    const stop = holdScrollWhileLoading({ page, scroller, top: 0 });
    scroller.scrollTop = 50;
    hand.grow();
    expect(scroller.scrollTop).toBe(50);
    stop();
  });
});
