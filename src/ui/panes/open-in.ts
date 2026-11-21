import type { OpenIn } from './layout.ts';

interface ClickLike {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

/**
 * Where a click asks a note to open, the way Obsidian and VS Code read it:
 * a middle click or ⌘/Ctrl-click opens a new tab, ⌥-click the other pane.
 */
export function openInFor(click: ClickLike): OpenIn {
  if (click.altKey) return 'side';
  if (click.button === 1 || click.metaKey || click.ctrlKey) return 'new-tab';
  return 'active';
}
