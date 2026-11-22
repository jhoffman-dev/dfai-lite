import { noteTitle, saveNoteText } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { retargetNote } from '../panes/layout.ts';
import type { AppContextValue } from '../services.ts';
import { createAutosave, type Autosave } from './autosave.ts';

export interface NoteSaver {
  readonly autosave: Autosave;
  /** The editor opened on `text`: saves are based on it, so a sync's edit underneath is noticed. */
  opened(text: string): void;
  /** The text the editor opened on or last saved. */
  basedOn(): string;
}

/**
 * Debounced saves of one note's editors. Each save says which text it was
 * based on; when a sync changed the note underneath, `saveNoteText` keeps
 * both, and the tabs on the note move to the copy holding what was typed here.
 */
export function createNoteSaver(app: AppContextValue, path: VaultPath): NoteSaver {
  const { deps, services, actions, ui, workspace } = app;
  let basedOnText = services.session.file(path)?.text ?? '';
  const save = async (text: string) => {
    const based = basedOnText;
    // Taken as the base before the write lands, so when the session hears the
    // write back it knows it for this save, not a change from disk. A write that fails
    // leaves the base ahead of the file: the next save then forks to a
    // conflict copy rather than writing over it, and nothing is lost.
    basedOnText = text;
    const result = await saveNoteText(deps, {
      path,
      text,
      basedOnText: based,
      clock: services.clock,
    });
    if (result.kind !== 'forked') return;
    ui.setState({
      notice: `“${noteTitle(path)}” changed elsewhere while you typed. Your text is in “${noteTitle(result.path)}”.`,
    });
    workspace.arrange((layout) => retargetNote(layout, path, result.path));
  };
  return {
    autosave: createAutosave({ save, onError: actions.report }),
    opened: (text) => {
      basedOnText = text;
    },
    basedOn: () => basedOnText,
  };
}
