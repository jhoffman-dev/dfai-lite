import { useEffect, useRef } from 'react';
import { asksForNewNote, type Route } from '../routing/route.ts';
import { useApp } from '../services.ts';

/**
 * Where the window goes by itself: `#/new` or `?new` make a note at once
 * (what a Shortcut or Dock icon opens); otherwise the first hash meets the
 * restored tabs (an empty hash shows the active tab, a note's hash opens it).
 * Each note opened is remembered for a launch with no saved tabs.
 */
export function useStartRoute(route: Route): void {
  const { actions, workspace } = useApp();
  const started = useRef(false);
  const making = useRef(false);

  useEffect(() => {
    const first = !started.current;
    started.current = true;
    if (route.kind === 'new' || (first && asksForNewNote(window.location))) {
      if (making.current) return;
      making.current = true;
      actions
        .newNote()
        .catch(actions.report)
        .finally(() => {
          making.current = false;
        });
      return;
    }
    if (first) workspace.followHash();
  }, [route, actions, workspace]);

  const openPath = route.kind === 'note' ? route.path : null;
  useEffect(() => {
    if (openPath !== null) actions.updatePrefs({ lastOpenPath: openPath });
  }, [openPath, actions]);
}
