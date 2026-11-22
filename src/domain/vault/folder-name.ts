import { forbiddenCharacter, MAX_NAME_LENGTH } from './file-name.ts';

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
