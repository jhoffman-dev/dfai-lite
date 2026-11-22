import type { ChangeSet } from '@codemirror/state';
import type { VaultSession } from '../../application/index.ts';
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
 * A note changed on disk (Claude, git, another editor), as the session heard
 * it. With nothing typed waiting, every editor on the note takes the new
 * text and saves are based on it; the note's own save reading back changes
 * nothing. With typing waiting, nothing happens here: that save finds the
 * note changed underneath and forks to a conflict copy, once, through the
 * one saver all its tabs share.
 */
function followDisk({ saver, mirror }: OpenNote, text: string | undefined): void {
  if (text === undefined || text === saver.basedOn() || !saver.autosave.isIdle()) return;
  saver.opened(text);
  mirror.adopt(text);
}

/**
 * One saver per note, however many tabs show it: two editors on a note save
 * through the same debounce, from the same base text, so neither saves over
 * the other or mistakes the other's save for a change from another device.
 * An entry with no editor holds nothing but that base, which the next editor
 * to open alone resets. Each note follows the disk once, not once per tab.
 */
export function createOpenNotes(session: VaultSession): OpenNotes {
  const notes = new Map<VaultPath, OpenNote>();
  // As long-lived as the session it listens to, so it is never taken away.
  session.subscribe((change) => {
    if (change.kind === 'loaded') {
      for (const [path, note] of notes) followDisk(note, session.file(path)?.text);
    } else if (change.kind === 'written') {
      const note = notes.get(change.path);
      if (note !== undefined) followDisk(note, session.file(change.path)?.text);
    }
  });
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
