import { isGeneratedIndexPath } from '../../domain/ai-index/index.ts';
import { INDEX_FOLDER, isWithin, type VaultPath } from '../../domain/vault/index.ts';
import type { StoredFile } from '../ports/index.ts';
import { writeFile, type VaultDeps } from '../use-cases/index.ts';

/** The files generated from the notes (`_index/*.md`): same notes, same files. */
export type DerivedFiles = (notes: readonly StoredFile[]) => readonly StoredFile[];

/**
 * Writes the `_index/` files the notes give now, and deletes those the
 * generator wrote before that the notes no longer give, so the next commit
 * carries a fresh index. A file under `_index/` the generator never writes
 * is someone else's: it is left as it is, and named in the warnings.
 */
export async function writeIndexFiles(
  deps: VaultDeps,
  derivedFiles: DerivedFiles,
): Promise<{ warnings: string[] }> {
  const notes = [...deps.session.allFiles()].filter(({ path }) => !isWithin(path, INDEX_FOLDER));
  const generated = derivedFiles(notes).filter(({ path }) => isWithin(path, INDEX_FOLDER));
  const wanted = new Set(generated.map(({ path }) => path));
  for (const { path, text } of generated) {
    if (deps.session.file(path)?.text !== text) await writeFile(deps, path, text);
  }
  const warnings: string[] = [];
  const left: VaultPath[] = [...deps.session.allFiles()]
    .map(({ path }) => path)
    .filter((path) => isWithin(path, INDEX_FOLDER) && !wanted.has(path));
  for (const path of left) {
    if (!isGeneratedIndexPath(path)) {
      warnings.push(`${path} is not a file the app writes in _index/; it was left as it is.`);
      continue;
    }
    // Generated, so nothing is lost for good: the Trash would only fill with index pages.
    const expected = deps.session.file(path)?.text ?? null;
    await deps.files.remove({ path, expected, permanently: true });
    deps.session.applyDelete(path);
  }
  return { warnings };
}
