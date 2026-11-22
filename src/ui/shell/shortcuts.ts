/**
 * Every keyboard shortcut in the app, in one table: key → command. A menu or
 * a native accelerator that wants the same command names it here, so a key
 * is defined once. The commands themselves are `commands.ts`.
 *
 * `mod` is ⌘ on a Mac and Ctrl elsewhere (either is accepted). A plain
 * browser keeps ⌘N, ⌘T and ⌘W for itself, so each has an Alt twin there;
 * the Mac app has the ⌘ keys and leaves ⌥N, ⌥T and ⌥W for typing ñ, † and ∑.
 */

/** Where the keys are pressed: the Mac app, or a browser tab (`pnpm dev`, the e2e smoke). */
export type KeyHost = 'desktop' | 'browser';

export type Command =
  | 'note.new'
  | 'note.toggleSource'
  | 'note.rename'
  | 'note.move'
  | 'palette.open'
  | 'history.back'
  | 'history.forward'
  | 'tab.new'
  | 'tab.close'
  | 'tab.next'
  | 'tab.previous'
  | 'tab.jump'
  | 'tab.moveLeft'
  | 'tab.moveRight'
  | 'pane.toggleSplit'
  | 'pane.focusLeft'
  | 'pane.focusRight'
  | 'sidebar.toggle'
  | 'view.toggleTheme'
  | 'help.shortcuts';

/** What each command does, in words: the keyboard shortcuts list reads these. */
export const COMMAND_TITLES: Readonly<Record<Command, string>> = {
  'note.new': 'New note',
  'palette.open': 'Find or create a note',
  'note.toggleSource': 'Show the note as plain markdown, or back in the editor',
  'note.rename': 'Rename the note',
  'note.move': 'Move the note to another folder',
  'history.back': 'Back',
  'history.forward': 'Forward',
  'tab.new': 'New tab',
  'tab.close': 'Close the tab',
  'tab.next': 'Next tab',
  'tab.previous': 'Previous tab',
  'tab.jump': 'Go to tab 1–8 (9: the last)',
  'tab.moveLeft': 'Move the tab left',
  'tab.moveRight': 'Move the tab right',
  'pane.toggleSplit': 'Split right, or unsplit an empty pane',
  'pane.focusLeft': 'Go to the left pane',
  'pane.focusRight': 'Go to the right pane',
  'sidebar.toggle': 'Show or hide the sidebar',
  'view.toggleTheme': 'Switch between the light and dark theme',
  'help.shortcuts': 'Keyboard shortcuts',
};

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
  /** A stand-in for a ⌘ key the browser keeps: not a shortcut in the Mac app. */
  readonly browserOnly?: boolean;
}

const digits: Shortcut[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((position) => ({
  chord: { mod: true, code: `Digit${position}` },
  command: 'tab.jump',
  arg: position,
}));

export const SHORTCUTS: readonly Shortcut[] = [
  { chord: { mod: true, code: 'KeyN' }, command: 'note.new' },
  { chord: { alt: true, code: 'KeyN' }, browserOnly: true, command: 'note.new' },
  { chord: { mod: true, key: 'k' }, command: 'palette.open' },
  { chord: { mod: true, key: 'e' }, command: 'note.toggleSource' },
  { chord: { key: 'F2' }, command: 'note.rename' },
  { chord: { mod: true, shift: true, code: 'KeyM' }, command: 'note.move' },
  // ⌘[ and ⌘] go back and forward, as in Safari, Finder, Notion and DFAI; a
  // browser has its own there, so it also takes Alt+← and Alt+→, its other pair.
  { chord: { mod: true, code: 'BracketLeft' }, command: 'history.back' },
  { chord: { alt: true, code: 'ArrowLeft' }, browserOnly: true, command: 'history.back' },
  { chord: { mod: true, code: 'BracketRight' }, command: 'history.forward' },
  { chord: { alt: true, code: 'ArrowRight' }, browserOnly: true, command: 'history.forward' },
  { chord: { mod: true, code: 'KeyT' }, command: 'tab.new' },
  { chord: { alt: true, code: 'KeyT' }, browserOnly: true, command: 'tab.new' },
  { chord: { mod: true, code: 'KeyW' }, command: 'tab.close' },
  { chord: { alt: true, code: 'KeyW' }, browserOnly: true, command: 'tab.close' },
  { chord: { mod: true, shift: true, code: 'BracketRight' }, command: 'tab.next' },
  { chord: { mod: true, shift: true, code: 'BracketLeft' }, command: 'tab.previous' },
  { chord: { mod: true, code: 'Tab' }, command: 'tab.next' },
  { chord: { mod: true, shift: true, code: 'Tab' }, command: 'tab.previous' },
  ...digits,
  { chord: { mod: true, alt: true, shift: true, code: 'ArrowLeft' }, command: 'tab.moveLeft' },
  { chord: { mod: true, alt: true, shift: true, code: 'ArrowRight' }, command: 'tab.moveRight' },
  // The browser and VS Code way, for a keyboard that has the keys.
  { chord: { mod: true, shift: true, code: 'PageUp' }, command: 'tab.moveLeft' },
  { chord: { mod: true, shift: true, code: 'PageDown' }, command: 'tab.moveRight' },
  { chord: { mod: true, code: 'Backslash' }, command: 'pane.toggleSplit' },
  { chord: { mod: true, alt: true, code: 'ArrowLeft' }, command: 'pane.focusLeft' },
  { chord: { mod: true, alt: true, code: 'ArrowRight' }, command: 'pane.focusRight' },
  // ⌘B is the editor's bold, so the sidebar takes ⌘⌥S.
  { chord: { mod: true, alt: true, code: 'KeyS' }, command: 'sidebar.toggle' },
  { chord: { mod: true, shift: true, code: 'KeyL' }, command: 'view.toggleTheme' },
  { chord: { mod: true, code: 'Slash' }, command: 'help.shortcuts' },
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

/** The shortcuts that are live on `host`. */
function shortcutsOn(host: KeyHost): readonly Shortcut[] {
  return host === 'browser'
    ? SHORTCUTS
    : SHORTCUTS.filter((shortcut) => shortcut.browserOnly !== true);
}

/** The shortcut a key press is on `host`, if any. */
export function shortcutFor(event: KeyLike, host: KeyHost): Shortcut | null {
  return shortcutsOn(host).find((shortcut) => matches(shortcut.chord, event)) ?? null;
}

/** Whether this is an Apple machine, where `mod` is ⌘ and keys print as symbols. */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Slash: '/',
  Tab: 'Tab',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
};

/** The key a chord names, as printed on the keycap: `KeyN` is N, `Digit1` is 1. */
function keyName(chord: Chord): string {
  const code = chord.code ?? '';
  if (code in KEY_NAMES) return KEY_NAMES[code] ?? code;
  const letter = /^(?:Key|Digit)(.)$/.exec(code)?.[1];
  if (letter !== undefined) return letter;
  const key = chord.key ?? code;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** A chord as people read it: ⌘⌥⇧← on a Mac, Ctrl+Alt+Shift+← elsewhere. */
export function chordLabel(chord: Chord, mac: boolean): string {
  const held = [
    chord.mod === true ? (mac ? '⌘' : 'Ctrl') : null,
    chord.alt === true ? (mac ? '⌥' : 'Alt') : null,
    chord.shift === true ? (mac ? '⇧' : 'Shift') : null,
  ].filter((name) => name !== null);
  return [...held, keyName(chord)].join(mac ? '' : '+');
}

/**
 * The key to show for a command, for a tooltip: "New tab (⌘T)". In a
 * browser that is the Alt twin, where there is one: the ⌘ key is the browser's.
 */
export function keyFor(command: Command, host: KeyHost, mac: boolean = IS_MAC): string {
  const keys = shortcutsOn(host).filter((candidate) => candidate.command === command);
  const shortcut = keys.find((candidate) => candidate.browserOnly === true) ?? keys[0];
  return shortcut === undefined ? '' : chordLabel(shortcut.chord, mac);
}

export interface ShortcutEntry {
  readonly command: Command;
  readonly title: string;
  /** Every chord that runs the command, in table order; a run of 1–9 is shown as one range. */
  readonly keys: readonly string[];
}

/** The shortcut table on `host` as a list to read, one entry per command, in the table's order. */
export function shortcutList(mac: boolean, host: KeyHost): ShortcutEntry[] {
  const keysOf = new Map<Command, string[]>();
  for (const { chord, command } of shortcutsOn(host)) {
    keysOf.set(command, [...(keysOf.get(command) ?? []), chordLabel(chord, mac)]);
  }
  return [...keysOf].map(([command, keys]) => ({
    command,
    title: COMMAND_TITLES[command],
    keys: keys.length > 3 ? [`${keys[0] ?? ''} … ${keys[keys.length - 1] ?? ''}`] : keys,
  }));
}
