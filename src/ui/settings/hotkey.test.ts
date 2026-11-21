import { acceleratorOf, shortcutLabel } from './hotkey.ts';

const press = (
  code: string,
  mods: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>>,
) => ({
  code,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
});

describe('the capture hotkey', () => {
  it('reads a key press as an accelerator, by its physical key', () => {
    expect(acceleratorOf(press('KeyN', { alt: true, meta: true }))).toBe('Alt+Command+N');
    expect(acceleratorOf(press('Digit1', { ctrl: true, shift: true }))).toBe('Control+Shift+1');
  });

  it('waits while only modifiers are down, and refuses a key with no modifier', () => {
    expect(acceleratorOf(press('MetaLeft', { meta: true }))).toBeNull();
    expect(acceleratorOf(press('KeyN', {}))).toBeNull();
    expect(acceleratorOf(press('KeyN', { shift: true }))).toBeNull();
  });

  it('shows an accelerator the way a Mac does', () => {
    expect(shortcutLabel('Alt+Command+N')).toBe('⌥⌘N');
    expect(shortcutLabel('')).toBe('None');
  });
});
