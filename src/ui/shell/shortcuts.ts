/**
 * Every keyboard shortcut in the app, in one table: key → command. A menu or
 * a native accelerator that wants the same command names it here, so a key
 * is defined once. The commands themselves are `commands.ts`.
 *
 * `mod` is ⌘ on a Mac and Ctrl elsewhere (either is accepted). A plain
 * browser keeps ⌘N, ⌘T and ⌘W for itself, so each has an Alt twin.
 */

export type Command =
  | 'note.new'
  | 'note.togglePreview'
  | 'note.rename'
  | 'palette.open'
  | 'tab.new'
  | 'tab.close'
  | 'tab.next'
  | 'tab.previous'
  | 'tab.jump'
  | 'pane.toggleSplit'
  | 'pane.focusLeft'
  | 'pane.focusRight';

/** A key and the exact modifiers held with it: any not named must be up. */
export interface Chord {
  /** `KeyboardEvent.code`: the physical key, so ⌥N still matches though it types "˜". */
  readonly code?: string;
  /** `KeyboardEvent.key`, compared without case. */
  readonly key?: string;
  readonly mod?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}

export interface Shortcut {
  readonly chord: Chord;
  readonly command: Command;
  /** For `tab.jump`: the tab's position, 1–9 (9 is the last tab). */
  readonly arg?: number;
}

const digits: Shortcut[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((position) => ({
  chord: { mod: true, code: `Digit${position}` },
  command: 'tab.jump',
  arg: position,
}));

export const SHORTCUTS: readonly Shortcut[] = [
  { chord: { mod: true, code: 'KeyN' }, command: 'note.new' },
  { chord: { alt: true, code: 'KeyN' }, command: 'note.new' },
  { chord: { mod: true, key: 'k' }, command: 'palette.open' },
  { chord: { mod: true, key: 'e' }, command: 'note.togglePreview' },
  { chord: { key: 'F2' }, command: 'note.rename' },
  { chord: { mod: true, code: 'KeyT' }, command: 'tab.new' },
  { chord: { alt: true, code: 'KeyT' }, command: 'tab.new' },
  { chord: { mod: true, code: 'KeyW' }, command: 'tab.close' },
  { chord: { alt: true, code: 'KeyW' }, command: 'tab.close' },
  { chord: { mod: true, shift: true, code: 'BracketRight' }, command: 'tab.next' },
  { chord: { mod: true, shift: true, code: 'BracketLeft' }, command: 'tab.previous' },
  { chord: { mod: true, code: 'Tab' }, command: 'tab.next' },
  { chord: { mod: true, shift: true, code: 'Tab' }, command: 'tab.previous' },
  ...digits,
  { chord: { mod: true, code: 'Backslash' }, command: 'pane.toggleSplit' },
  { chord: { mod: true, alt: true, code: 'ArrowLeft' }, command: 'pane.focusLeft' },
  { chord: { mod: true, alt: true, code: 'ArrowRight' }, command: 'pane.focusRight' },
];

interface KeyLike {
  readonly code: string;
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

function matches(chord: Chord, event: KeyLike): boolean {
  if ((chord.mod ?? false) !== (event.metaKey || event.ctrlKey)) return false;
  if ((chord.alt ?? false) !== event.altKey || (chord.shift ?? false) !== event.shiftKey) {
    return false;
  }
  if (chord.code !== undefined) return chord.code === event.code;
  return chord.key !== undefined && chord.key.toLowerCase() === event.key.toLowerCase();
}

/** The shortcut a key press is, if any. */
export function shortcutFor(event: KeyLike): Shortcut | null {
  return SHORTCUTS.find((shortcut) => matches(shortcut.chord, event)) ?? null;
}
