import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '../../application/index.ts';
import {
  createThemeController,
  resolveTheme,
  type SystemScheme,
  type Theme,
  type ThemeChoice,
} from './theme.ts';

function memorySettings(theme: ThemeChoice = 'system'): SettingsStore & { saved: Settings[] } {
  let current: Settings = { ...DEFAULT_SETTINGS, ui: { ...DEFAULT_SETTINGS.ui, theme } };
  const saved: Settings[] = [];
  return {
    saved,
    load: () => current,
    save: (settings) => {
      current = settings;
      saved.push(settings);
    },
  };
}

function fakeSystem(dark: boolean): SystemScheme & { set(dark: boolean): void } {
  const listeners = new Set<() => void>();
  return {
    isDark: () => dark,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    set: (next) => {
      dark = next;
      for (const listener of listeners) listener();
    },
  };
}

function setUp(choice: ThemeChoice, systemDark: boolean) {
  const settings = memorySettings(choice);
  const system = fakeSystem(systemDark);
  const shown: Theme[] = [];
  const remembered: ThemeChoice[] = [];
  const controller = createThemeController({
    settings,
    system,
    root: { show: (theme) => shown.push(theme) },
    remember: (next) => remembered.push(next),
  });
  return { controller, settings, system, shown, remembered };
}

describe('resolveTheme', () => {
  it('follows the system for System, and is the choice otherwise', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('the theme controller', () => {
  it('applies the stored choice at once, before anything is chosen', () => {
    const { controller, shown, remembered } = setUp('dark', false);
    expect(controller.choice()).toBe('dark');
    expect(controller.theme()).toBe('dark');
    expect(shown).toEqual(['dark']);
    expect(remembered).toEqual(['dark']);
  });

  it('follows the system live while the choice is System', () => {
    const { controller, system, shown } = setUp('system', false);
    let heard = 0;
    controller.subscribe(() => (heard += 1));
    system.set(true);
    expect(controller.theme()).toBe('dark');
    expect(shown).toEqual(['light', 'dark']);
    expect(heard).toBe(1);
  });

  it('holds a chosen theme whatever the system does', () => {
    const { controller, system, shown } = setUp('light', false);
    system.set(true);
    expect(controller.theme()).toBe('light');
    expect(shown).toEqual(['light']);
  });

  it('keeps a choice in this device’s settings, beside the other preferences', () => {
    const { controller, settings, shown, remembered } = setUp('system', false);
    controller.choose('dark');
    expect(settings.load().ui).toEqual({ ...DEFAULT_SETTINGS.ui, theme: 'dark' });
    expect(settings.load().captureHotkey).toBe(DEFAULT_SETTINGS.captureHotkey);
    expect(shown.at(-1)).toBe('dark');
    expect(remembered.at(-1)).toBe('dark');
    controller.choose('system');
    expect(settings.load().ui.theme).toBe('system');
    expect(controller.theme()).toBe('light');
  });

  it('saves nothing when the choice does not change', () => {
    const { controller, settings } = setUp('light', false);
    controller.choose('light');
    expect(settings.saved).toEqual([]);
  });

  it('toggles to the other theme of the one showing, as a choice', () => {
    const { controller } = setUp('system', true);
    controller.toggle();
    expect(controller.choice()).toBe('light');
    controller.toggle();
    expect(controller.choice()).toBe('dark');
  });

  it('tells the window’s chrome the choice at start and on every change', () => {
    const followed: ThemeChoice[] = [];
    const controller = createThemeController({
      settings: memorySettings('dark'),
      system: fakeSystem(false),
      root: { show: () => undefined },
      remember: () => undefined,
      follow: (choice) => followed.push(choice),
    });
    controller.choose('system');
    expect(followed).toEqual(['dark', 'system']);
  });

  it('stops telling a listener once it has unsubscribed', () => {
    const { controller } = setUp('light', false);
    let heard = 0;
    const stop = controller.subscribe(() => (heard += 1));
    stop();
    controller.choose('dark');
    expect(heard).toBe(0);
  });
});
