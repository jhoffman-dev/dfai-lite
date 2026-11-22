import { useSyncExternalStore } from 'react';
import type { Theme, ThemeChoice, ThemeController } from './theme.ts';

/** The theme choice and the theme in force, redrawn whenever either changes. */
export function useTheme(controller: ThemeController): { choice: ThemeChoice; theme: Theme } {
  const choice = useSyncExternalStore(controller.subscribe, controller.choice);
  const theme = useSyncExternalStore(controller.subscribe, controller.theme);
  return { choice, theme };
}
