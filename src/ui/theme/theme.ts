import type { SettingsStore, UiPrefs } from '../../application/index.ts';

/** What was chosen in Settings → Appearance: follow macOS, or one theme whatever macOS is set to. */
export type ThemeChoice = UiPrefs['theme'];

/** The theme in force: the choice, or the system's while the choice is System. */
export type Theme = 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** The theme a choice comes to, given whether the system is dark. */
export function resolveTheme(choice: ThemeChoice, systemIsDark: boolean): Theme {
  if (choice === 'system') return systemIsDark ? 'dark' : 'light';
  return choice;
}

/** The operating system's light or dark preference, followed live. */
export interface SystemScheme {
  isDark(): boolean;
  /** Hears the preference change; returns the way to stop listening. */
  subscribe(onChange: () => void): () => void;
}

/** Where the theme is drawn: `data-theme` on the document's root, which the tokens read. */
export interface ThemeRoot {
  show(theme: Theme): void;
}

export interface ThemeController {
  choice(): ThemeChoice;
  theme(): Theme;
  choose(choice: ThemeChoice): void;
  /** Light to dark or dark to light, as a choice: what the palette's command does. */
  toggle(): void;
  /** Hears every change of choice or, while following the system, of the system's theme. */
  subscribe(listener: () => void): () => void;
}

/**
 * The theme, applied at once and kept: the choice is this device's
 * (`UiPrefs.theme`, saved through the settings store), and while it is
 * System the theme follows the operating system as it changes. `remember`
 * keeps a copy where the page's first script can read it before the app
 * runs, so a dark choice never paints light first.
 */
export function createThemeController({
  settings,
  system,
  root,
  remember,
}: {
  settings: SettingsStore;
  system: SystemScheme;
  root: ThemeRoot;
  remember: (choice: ThemeChoice) => void;
}): ThemeController {
  let choice = settings.load().ui.theme;
  let theme = resolveTheme(choice, system.isDark());
  const listeners = new Set<() => void>();

  const apply = () => {
    theme = resolveTheme(choice, system.isDark());
    root.show(theme);
    for (const listener of listeners) listener();
  };
  root.show(theme);
  remember(choice);
  // Kept for the app's life: the controller is made once, at start.
  system.subscribe(() => {
    if (choice === 'system') apply();
  });

  const choose = (next: ThemeChoice) => {
    if (next === choice) return;
    choice = next;
    const current = settings.load();
    settings.save({ ...current, ui: { ...current.ui, theme: next } });
    remember(next);
    apply();
  };

  return {
    choice: () => choice,
    theme: () => theme,
    choose,
    toggle: () => choose(theme === 'dark' ? 'light' : 'dark'),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
