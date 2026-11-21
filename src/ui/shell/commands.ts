import {
  BLANK,
  closeTab,
  currentTab,
  cycleTab,
  focusPane,
  jumpToTab,
  toggleSplit,
} from '../panes/layout.ts';
import { isNarrow } from '../panes/narrow.ts';
import type { AppContextValue } from '../services.ts';
import type { Command } from './shortcuts.ts';

/** Runs a command; `arg` is the position for `tab.jump`. */
export type RunCommand = (command: Command, arg?: number) => void;

/** What each command in the shortcut table does, on the active pane and tab. */
export function createCommands({ actions, ui, layout, workspace }: AppContextValue): RunCommand {
  const activeNote = () => {
    const { view } = currentTab(layout.getState());
    return view.kind === 'note' ? view.path : null;
  };
  const run: Record<Command, (arg: number) => void> = {
    'note.new': () => actions.newNote().catch(actions.report),
    'note.togglePreview': () => actions.togglePreview(),
    'note.rename': () => {
      const path = activeNote();
      if (path !== null) ui.setState({ pendingFocus: { path, target: 'title' } });
    },
    'palette.open': () => ui.setState({ paletteOpen: true }),
    'tab.new': () => {
      workspace.open(BLANK, 'new-tab', { replace: true });
      ui.setState({ paletteOpen: true });
    },
    'tab.close': () => {
      const { preview } = ui.getState();
      workspace.arrange((current) => closeTab(current, currentTab(current).id, { preview }));
    },
    'tab.next': () => workspace.arrange((current) => cycleTab(current, 1)),
    'tab.previous': () => workspace.arrange((current) => cycleTab(current, -1)),
    'tab.jump': (position) => workspace.arrange((current) => jumpToTab(current, position)),
    'pane.toggleSplit': () => {
      if (!isNarrow()) workspace.arrange(toggleSplit);
    },
    'pane.focusLeft': () => workspace.arrange((current) => focusPane(current, 0)),
    'pane.focusRight': () => workspace.arrange((current) => focusPane(current, 1)),
  };
  return (command, arg = 0) => run[command](arg);
}
