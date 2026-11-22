import type { KeyboardEvent } from 'react';

const STEPS: Readonly<Record<string, (columns: number) => number>> = {
  ArrowRight: () => 1,
  ArrowLeft: () => -1,
  ArrowDown: (columns) => columns,
  ArrowUp: (columns) => -columns,
};

/**
 * Arrow keys walk a grid of choices (`[role="radio"]` inside the element the
 * handler is on), `columns` to a row; Home and End go to the ends. Focus
 * moves; nothing is picked until Enter, Space or a click, so walking past
 * choices does not save each one.
 */
export function gridKeys(columns: number) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const cells = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
    const at = cells.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    const step = STEPS[event.key];
    let next: number;
    if (step !== undefined) next = Math.max(0, Math.min(cells.length - 1, at + step(columns)));
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = cells.length - 1;
    else return;
    event.preventDefault();
    cells[next]?.focus();
  };
}

/** The one cell of a grid that takes Tab: the chosen one, or the first when none is. */
export function tabStopOf(checked: boolean, index: number, anyChecked: boolean): 0 | -1 {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}
