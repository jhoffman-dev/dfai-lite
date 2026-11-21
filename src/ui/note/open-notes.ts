import type { ChangeSet } from '@codemirror/state';
import type { VaultPath } from '../../domain/vault/index.ts';
import type { AppContextValue } from '../services.ts';
import { createNoteMirror, type NoteMirror } from './note-mirror.ts';
import { createNoteSaver, type NoteSaver } from './note-saver.ts';

/** What every tab showing one note shares: one saver, and the mirror between its editors. */
export interface OpenNote {
  readonly saver: NoteSaver;
  readonly mirror: NoteMirror<ChangeSet>;
}

export interface OpenNotes {
  /** The note's shared saver and mirror, made the first time the note is shown. */
  get(app: AppContextValue, path: VaultPath): OpenNote;
}

/**
 * One saver per note, however many tabs show it: two editors on a note save
 * through the same debounce, from the same base text, so neither saves over
 * the other or mistakes the other's save for a change from another device.
 * An entry with no editor holds nothing but that base, which the next editor
 * to open alone resets.
 */
export function createOpenNotes(): OpenNotes {
  const notes = new Map<VaultPath, OpenNote>();
  return {
    get(app, path) {
      let note = notes.get(path);
      if (note === undefined) {
        note = { saver: createNoteSaver(app, path), mirror: createNoteMirror() };
        notes.set(path, note);
      }
      return note;
    },
  };
}
