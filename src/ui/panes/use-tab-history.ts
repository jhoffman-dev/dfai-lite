import { useMemo } from 'react';
import { useApp } from '../services.ts';
import type { PageHistory } from '../shell/page-bar.tsx';
import { tabTitle } from '../tabs/tab-bar.tsx';
import { tabById } from './layout.ts';
import { useLayout } from './layout-store.ts';
import { destination } from './tab-history.ts';

/** Tab `tabId`'s Back and Forward, for the bar of the page it shows: where each leads, by name. */
export function useTabHistory(tabId: string): PageHistory {
  const { workspace } = useApp();
  const back = useLayout((layout) => {
    const tab = tabById(layout, tabId);
    return tab === undefined ? null : destination(tab, 'back');
  });
  const forward = useLayout((layout) => {
    const tab = tabById(layout, tabId);
    return tab === undefined ? null : destination(tab, 'forward');
  });
  return useMemo(
    () => ({
      back: back === null ? null : tabTitle(back),
      forward: forward === null ? null : tabTitle(forward),
      onBack: () => workspace.step('back', tabId),
      onForward: () => workspace.step('forward', tabId),
    }),
    [back, forward, workspace, tabId],
  );
}
