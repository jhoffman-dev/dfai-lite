import { INDEX_FOLDER, isWithin, type VaultPath } from '../../domain/vault/index.ts';
import type { StoredFile } from '../ports/index.ts';
import { writeFile, type VaultDeps } from '../use-cases/index.ts';

/** The files generated from the notes (`_index/*.md`): same notes, same files. */
export type DerivedFiles = (notes: readonly StoredFile[]) => readonly StoredFile[];

/**
 * Writes the `_index/` files the notes give now, and removes any left from
 * notes since gone, so the next commit carries a fresh index. The session is
 * read first from disk where it holds `_index/` files git left in conflict.
 * Says which paths it touched.
 */
export async function writeIndexFiles(
  deps: VaultDeps,
  derivedFiles: DerivedFiles,
): Promise<VaultPath[]> {
  const notes = [...deps.session.allFiles()].filter(({ path }) => !isWithin(path, INDEX_FOLDER));
  const generated = derivedFiles(notes).filter(({ path }) => isWithin(path, INDEX_FOLDER));
  const wanted = new Set(generated.map(({ path }) => path));
  const touched: VaultPath[] = [];
  for (const { path, text } of generated) {
    if (deps.session.file(path)?.text === text) continue;
    await writeFile(deps, path, text);
    touched.push(path);
  }
  const stale = [...deps.session.allFiles()]
    .map(({ path }) => path)
    .filter((path) => isWithin(path, INDEX_FOLDER) && !wanted.has(path));
  for (const path of stale) {
    await deps.files.remove(path);
    deps.session.applyDelete(path);
    touched.push(path);
  }
  return touched;
}
