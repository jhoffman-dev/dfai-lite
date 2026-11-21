import { useEffect, useMemo } from 'react';
import { useApp } from '../services.ts';
import { createCommands } from './commands.ts';
import { shortcutFor, type KeyHost } from './shortcuts.ts';

/** Which keys are live: the Mac app's ⌘ keys, or a browser's with their Alt twins. */
export function useKeyHost(): KeyHost {
  return useApp().services.desktop === null ? 'browser' : 'desktop';
}

/** The app's keys (`shortcuts.ts`), caught before the editor sees them. */
export function useShortcuts(): void {
  const app = useApp();
  const host = useKeyHost();
  const run = useMemo(() => createCommands(app), [app]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event, host);
      if (shortcut === null) return;
      event.preventDefault();
      event.stopPropagation();
      run(shortcut.command, shortcut.arg);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [run, host]);
}
