import type { VaultPath } from './note-path.ts';

/**
 * Where meeting transcripts live: one note per transcript, out of the
 * meetings' way. Nobody reads them as notes, so the graph and the tags leave
 * them out; a meeting note links its own with a `- Transcript:` line.
 */
export const TRANSCRIPTS_FOLDER = 'Transcripts';

/** Whether a path is under the top-level `Transcripts/` folder. */
export const isTranscriptPath = (path: VaultPath): boolean =>
  path.startsWith(`${TRANSCRIPTS_FOLDER}/`);
