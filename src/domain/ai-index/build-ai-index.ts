import { VaultIndex } from '../index/index.ts';
import { isConflictCopyPath } from '../sync/index.ts';
import { isTranscriptPath, isVaultGuide, isVisibleNote, type VaultPath } from '../vault/index.ts';
import { folderFiles } from './folder-files.ts';
import { meetingFiles } from './meeting-files.ts';
import { noteLine } from './note-line.ts';
import { readmeFile } from './readme-file.ts';
import { sortedTagTree, tagFile } from './tag-file.ts';
import { byCode, type IndexFile } from './text.ts';

/**
 * The `_index/` files for a vault: a map Claude reads instead of the notes, so
 * it opens only the few that matter. Pure and deterministic — the same notes,
 * in any order, give the same files byte for byte, sorted by path. Hidden
 * paths (`_index/`, `.dfai-lite/`, dotfiles), non-markdown files and the
 * root `CLAUDE.md`, `README.md` and `MIGRATION-REPORT.md` are left out.
 * Transcript notes are only counted in the README: a line each would bloat
 * the index with notes Claude opens only for a quote or a summary, and each
 * meeting note's `- Transcript:` line already names its own.
 */
export function buildAiIndex(notes: readonly IndexFile[]): readonly IndexFile[] {
  const readable = notes.filter(({ path }) => isVisibleNote(path) && !isVaultGuide(path));
  const visible = readable.filter(({ path }) => !isTranscriptPath(path));
  const index = VaultIndex.build(visible);
  const texts = new Map<VaultPath, string>(visible.map(({ path, text }) => [path, text]));
  const paths = index.paths();
  const entries = paths.map((path) => ({ path, line: noteLine(index, path) }));
  const folders = folderFiles(entries);
  const meetings = meetingFiles(index, texts);
  const tags = sortedTagTree(index);
  const readme = readmeFile({
    total: paths.length,
    folders: folders.folders,
    months: meetings.months,
    tags,
    conflictCopies: paths.filter(isConflictCopyPath),
    transcripts: readable.length - visible.length,
  });
  const files = [readme, ...folders.files, tagFile(index, tags), ...meetings.files];
  assertDistinctPaths(files);
  return files.sort((left, right) => byCode(left.path, right.path));
}

/** The generator's own invariant: two files at one path would mean one silently overwrites the other. */
function assertDistinctPaths(files: readonly IndexFile[]): void {
  const seen = new Set<string>();
  for (const { path } of files) {
    if (seen.has(path)) throw new Error(`AI index bug: two generated files at ${path}`);
    seen.add(path);
  }
}
