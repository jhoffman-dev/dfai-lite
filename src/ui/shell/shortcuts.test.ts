import { chordLabel, COMMAND_TITLES, SHORTCUTS, shortcutFor, shortcutList } from './shortcuts.ts';

const press = (code: string, held: { meta?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  code,
  key: '',
  metaKey: held.meta ?? false,
  ctrlKey: false,
  altKey: held.alt ?? false,
  shiftKey: held.shift ?? false,
});

describe('shortcuts', () => {
  it('moves a tab with ⌘⌥⇧←/→ and Ctrl+Shift+Page Up/Down, apart from pane focus', () => {
    const moveKeys = { meta: true, alt: true, shift: true };
    expect(shortcutFor(press('ArrowLeft', moveKeys))?.command).toBe('tab.moveLeft');
    expect(shortcutFor(press('ArrowRight', moveKeys))?.command).toBe('tab.moveRight');
    expect(shortcutFor(press('PageUp', { meta: true, shift: true }))?.command).toBe('tab.moveLeft');
    expect(shortcutFor(press('ArrowLeft', { meta: true, alt: true }))?.command).toBe(
      'pane.focusLeft',
    );
  });

  it('gives no two shortcuts the same chord', () => {
    const chords = SHORTCUTS.map(({ chord }) => JSON.stringify(chord));
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('prints chords as a Mac shows them, and as other systems do', () => {
    const chord = { mod: true, alt: true, shift: true, code: 'ArrowLeft' };
    expect(chordLabel(chord, true)).toBe('⌘⌥⇧←');
    expect(chordLabel(chord, false)).toBe('Ctrl+Alt+Shift+←');
    expect(chordLabel({ mod: true, code: 'KeyT' }, true)).toBe('⌘T');
    expect(chordLabel({ mod: true, key: 'k' }, false)).toBe('Ctrl+K');
    expect(chordLabel({ key: 'F2' }, true)).toBe('F2');
  });

  it('lists every command in the table once, with all its keys', () => {
    const list = shortcutList(true);
    const commands = new Set(SHORTCUTS.map((shortcut) => shortcut.command));
    expect(list.map((entry) => entry.command)).toEqual([...commands]);
    expect(list.every((entry) => entry.title === COMMAND_TITLES[entry.command])).toBe(true);
    const keysOf = (command: string) => list.find((entry) => entry.command === command)?.keys;
    expect(keysOf('tab.new')).toEqual(['⌘T', '⌥T']);
    expect(keysOf('tab.jump')).toEqual(['⌘1 … ⌘9']);
  });
});
