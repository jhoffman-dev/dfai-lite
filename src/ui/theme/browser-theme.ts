import type { SystemScheme, ThemeChoice, ThemeRoot } from './theme.ts';

/**
 * The browser's side of the theme: the system's preference, the root
 * element, and the copy of the choice `public/theme-boot.js` reads before
 * the app runs. The key and the attribute are that script's too: change
 * them together.
 */
export const THEME_KEY = 'dfai-lite.theme';

const SYSTEM_DARK = '(prefers-color-scheme: dark)';

/** The system's preference, or null where it cannot be asked (jsdom; a strict privacy setting). */
function systemQuery(win: Window): MediaQueryList | null {
  try {
    return win.matchMedia?.(SYSTEM_DARK) ?? null;
  } catch {
    // Nothing to recover: with no answer, light is the default.
    return null;
  }
}

export function browserSystemScheme(win: Window): SystemScheme {
  const query = systemQuery(win);
  return {
    isDark: () => query?.matches === true,
    subscribe: (onChange) => {
      query?.addEventListener('change', onChange);
      return () => query?.removeEventListener('change', onChange);
    },
  };
}

export function documentThemeRoot(doc: Document): ThemeRoot {
  return {
    show: (theme) => {
      doc.documentElement.dataset['theme'] = theme;
    },
  };
}

export function rememberThemeIn(storage: () => Storage): (choice: ThemeChoice) => void {
  return (choice) => {
    try {
      storage().setItem(THEME_KEY, choice);
    } catch {
      // Safe to ignore: storage may be blocked, as in a private window. The
      // settings store still holds the choice; only the first paint may differ.
    }
  };
}

/** The controller's parts in this window. */
export function browserThemeParts(win: Window) {
  return {
    system: browserSystemScheme(win),
    root: documentThemeRoot(win.document),
    remember: rememberThemeIn(() => win.localStorage),
  };
}
