import { useEffect, useMemo } from 'react';
import { useApp } from '../services.ts';
import { createCommands } from './commands.ts';
import { shortcutFor, type Command, type KeyHost } from './shortcuts.ts';

/** `MouseEvent.button` for a mouse's back (3) and forward (4) buttons. */
const MOUSE_COMMANDS: Readonly<Partial<Record<number, Command>>> = {
  3: 'history.back',
  4: 'history.forward',
};

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
    // A mouse's own back and forward buttons do what ⌘[ and ⌘] do, as in DFAI.
    const onMouseUp = (event: MouseEvent) => {
      const command = MOUSE_COMMANDS[event.button];
      if (command === undefined) return;
      event.preventDefault();
      run(command);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [run, host]);
}
