import { useEffect, useMemo } from 'react';
import { useApp } from '../services.ts';
import { createCommands } from './commands.ts';
import { shortcutFor } from './shortcuts.ts';

/** The app's keys (`shortcuts.ts`), caught before the editor sees them. */
export function useShortcuts(): void {
  const app = useApp();
  const run = useMemo(() => createCommands(app), [app]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event);
      if (shortcut === null) return;
      event.preventDefault();
      event.stopPropagation();
      run(shortcut.command, shortcut.arg);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [run]);
}
