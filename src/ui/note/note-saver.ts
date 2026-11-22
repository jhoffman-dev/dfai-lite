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
  const { deps, services, ui, workspace } = app;
  let basedOnText = services.session.file(path)?.text ?? '';
  const save = async (text: string) => {
    const based = basedOnText;
    // Taken as the base before the write lands, so when the session hears the
    // write back it knows it for this save, not a change from disk.
    basedOnText = text;
    let result;
    try {
      result = await saveNoteText(deps, { path, text, basedOnText: based, clock: services.clock });
    } catch (error) {
      // Not written (a full disk, a refused file, sync holding the vault): the
      // note still holds the old base, and the next try is based on it again,
      // or it would fork as if the note had changed elsewhere.
      const unwritten = services.session.file(path)?.text !== text;
      if (unwritten && basedOnText === text) basedOnText = based;
      throw error;
    }
    if (result.kind !== 'forked') return;
    ui.setState({
      notice: `“${noteTitle(path)}” changed elsewhere while you typed. Your text is in “${noteTitle(result.path)}”.`,
    });
    workspace.arrange((layout) => retargetNote(layout, path, result.path));
  };
  return {
    autosave: createAutosave({
      save,
      onError: (error) =>
        ui.setState({
          notice: `Could not save “${noteTitle(path)}” (${error instanceof Error ? error.message : String(error)}). Trying again; your text is kept.`,
        }),
    }),
    opened: (text) => {
      basedOnText = text;
    },
    basedOn: () => basedOnText,
  };
}
