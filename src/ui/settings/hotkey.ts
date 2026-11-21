/** The keyboard event's parts a shortcut is made of. */
export interface KeyPress {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const MODIFIER_CODES = /^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/;

/** The key's name as Tauri's accelerators spell it, from its physical code; null for one it has none for. */
function keyName(code: string): string | null {
  const letterOrDigit = /^(?:Key|Digit)([A-Z0-9])$/.exec(code);
  if (letterOrDigit !== null) return letterOrDigit[1] ?? null;
  if (/^F\d{1,2}$/.test(code)) return code;
  return ['Space', 'Enter', 'Backquote', 'Minus', 'Equal', 'Comma', 'Period', 'Slash'].includes(
    code,
  )
    ? code
    : null;
}

/**
 * A key press as a global shortcut, e.g. `Alt+Command+N`: at least one
 * modifier besides Shift and one ordinary key. Null while only modifiers are
 * down, or for a key a shortcut cannot use.
 */
export function acceleratorOf(press: KeyPress): string | null {
  if (MODIFIER_CODES.test(press.code)) return null;
  const key = keyName(press.code);
  if (key === null || !(press.metaKey || press.ctrlKey || press.altKey)) return null;
  const parts = [
    press.ctrlKey ? 'Control' : null,
    press.altKey ? 'Alt' : null,
    press.shiftKey ? 'Shift' : null,
    press.metaKey ? 'Command' : null,
  ].filter((part): part is string => part !== null);
  return [...parts, key].join('+');
}

const SYMBOLS: Readonly<Record<string, string>> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
};

/** `Alt+Command+N` as a Mac shows it: `⌥⌘N`. */
export function shortcutLabel(accelerator: string): string {
  if (accelerator === '') return 'None';
  return accelerator
    .split('+')
    .map((part) => SYMBOLS[part] ?? part)
    .join('');
}
