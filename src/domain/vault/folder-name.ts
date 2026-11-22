import { forbiddenCharacter, MAX_NAME_LENGTH } from './file-name.ts';
import { foldedPath, type VaultPath } from './note-path.ts';
import { INDEX_FOLDER } from './visibility.ts';

/** Why `name` cannot be a folder's name as typed, or null when it can: a note's rules, in a folder's words. */
export function folderNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give the folder a name.';
  const forbidden = forbiddenCharacter(trimmed);
  if (forbidden !== null) return `A folder’s name cannot hold ${forbidden}`;
  if (trimmed.startsWith('.')) return 'A folder’s name cannot start with a dot.';
  if (trimmed.length > MAX_NAME_LENGTH) return `Keep the name under ${MAX_NAME_LENGTH} characters.`;
  return null;
}

/**
 * Why a folder cannot be at `path` (made, renamed or moved there), or null
 * when it can: every part a good folder name (so no dot names, the app's
 * `.dfai-lite` among them), and not under the generated `_index/`.
 */
export function folderPathProblem(path: VaultPath): string | null {
  if (path === '') return 'Give the folder a name.';
  const parts = path.split('/');
  for (const part of parts) {
    const problem = folderNameProblem(part);
    if (problem !== null) return problem;
  }
  if (foldedPath(parts[0] ?? '') === foldedPath(INDEX_FOLDER)) {
    return `${INDEX_FOLDER} is kept for the generated index.`;
  }
  return null;
}
