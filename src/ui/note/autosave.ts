/** Typing stops for this long, then the note is saved. */
export const AUTOSAVE_DELAY_MS = 300;

/** A save that failed is tried again after this long, with whatever was typed since. */
export const AUTOSAVE_RETRY_MS = 2000;

export interface Autosave {
  /** Typing happened: save `read()` once typing stops. Reads nothing now, so a keystroke costs nothing. */
  schedule(read: () => string): void;
  /** Saves now, if anything is waiting. Resolves when the save is kept. */
  flush(): Promise<void>;
  /** Whether nothing typed is waiting to be saved. */
  isIdle(): boolean;
}

/**
 * Debounced saving for one note. The text is read when the save runs, not
 * on each keystroke; saves never overlap, so they land in the order typed.
 * A save that fails is reported and kept waiting: it is tried again, with
 * the newest text, until it lands, so nothing typed is dropped.
 */
export function createAutosave({
  save,
  onError,
  delayMs = AUTOSAVE_DELAY_MS,
  retryMs = AUTOSAVE_RETRY_MS,
}: {
  save: (text: string) => Promise<void>;
  onError: (error: unknown) => void;
  delayMs?: number;
  retryMs?: number;
}): Autosave {
  let pending: (() => string) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const read = pending;
    pending = null;
    if (read !== null) {
      running = running.then(() => save(read())).catch((error: unknown) => {
        onError(error);
        retry(read);
      });
    }
    return running;
  };

  /** Keeps a failed save waiting, unless newer typing already is, and tries it again later. */
  const retry = (read: () => string) => {
    pending ??= read;
    timer ??= setTimeout(() => void flush(), retryMs);
  };

  return {
    schedule(read) {
      pending = read;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    isIdle: () => pending === null,
  };
}
