import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { clampSplit, EVEN_SPLIT } from './layout.ts';

const KEY_STEP = 0.05;

/**
 * The bar between two panes: drag it, or focus it and use ←/→ (Home and End
 * go to the limits); a double click evens the panes. While dragging, only a
 * CSS variable moves; the share is kept once, on release.
 */
export function Divider({ split, onChange }: { split: number; onChange: (split: number) => void }) {
  const dragging = useRef(false);

  const shareAt = (event: PointerEvent<HTMLDivElement>) => {
    const frame = event.currentTarget.parentElement?.getBoundingClientRect();
    return frame === undefined || frame.width === 0
      ? split
      : (event.clientX - frame.left) / frame.width;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const next: Record<string, number> = {
      ArrowLeft: split - KEY_STEP,
      ArrowRight: split + KEY_STEP,
      Home: 0,
      End: 1,
    };
    const value = next[event.key];
    if (value === undefined) return;
    event.preventDefault();
    onChange(value);
  };

  return (
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panes"
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(split * 100)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(EVEN_SPLIT)}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        const frame = event.currentTarget.parentElement;
        frame?.style.setProperty('--split', String(clampSplit(shareAt(event))));
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        onChange(shareAt(event));
      }}
    />
  );
}
