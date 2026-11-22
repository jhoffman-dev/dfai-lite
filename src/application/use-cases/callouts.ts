import {
  CALLOUTS_PATH,
  NO_CALLOUT_SETTINGS,
  checkCalloutDraft,
  serializeCalloutSettings,
  usesCalloutType,
  withBuiltInHidden,
  withCalloutType,
  withoutCalloutType,
  type CalloutDraft,
  type CalloutDraftProblems,
  type CalloutSettings,
} from '../../domain/callouts/index.ts';
import { isVisibleNote, type VaultPath } from '../../domain/vault/index.ts';
import { FileChangedError, TrashRefusedError } from '../ports/index.ts';
import { writeFile, type VaultDeps } from './vault-deps.ts';

/** The callouts file could not be read; it is only written over when the person says so. */
export class UnreadableCalloutsError extends Error {
  override readonly name = 'UnreadableCalloutsError';
}

/**
 * Writes the vault's callout settings: once, guarded by the text the
 * session holds, so a file changed on disk since (the other Mac's, pulled)
 * is never written over. A conflict copy's types were merged into what is
 * written, so the copy then goes to the Trash: nothing it held is lost.
 */
async function writeCalloutSettings(deps: VaultDeps, settings: CalloutSettings): Promise<void> {
  if (deps.session.calloutsProblem !== null) {
    throw new UnreadableCalloutsError(deps.session.calloutsProblem);
  }
  const copies = deps.session.calloutCopies;
  await writeFile(deps, CALLOUTS_PATH, serializeCalloutSettings(settings));
  for (const path of copies) await retireCopy(deps, path);
}

async function retireCopy({ files, session }: VaultDeps, path: VaultPath): Promise<void> {
  try {
    await files.remove({ path, expected: session.file(path)?.text ?? null, permanently: false });
    session.applyDelete(path);
  } catch (error) {
    // Left in place, the copy is merged in again on the next read, and its
    // types are in the file already: nothing is lost, the next save retries.
    if (error instanceof FileChangedError || error instanceof TrashRefusedError) return;
    throw error;
  }
}

export type SaveCalloutTypeResult =
  | { readonly kind: 'saved' }
  | { readonly kind: 'invalid'; readonly problems: CalloutDraftProblems };

/** Adds a callout type, or saves one edited (`replacing` its old name); a draft with problems writes nothing. */
export async function saveCalloutType(
  deps: VaultDeps,
  { draft, replacing }: { draft: CalloutDraft; replacing: string | null },
): Promise<SaveCalloutTypeResult> {
  const settings = deps.session.calloutSettings;
  const checked = checkCalloutDraft(draft, { settings, replacing });
  if (checked.kind === 'invalid') return checked;
  await writeCalloutSettings(deps, withCalloutType(settings, { type: checked.type, replacing }));
  return { kind: 'saved' };
}

/** Deletes a callout type. Notes using it keep their text and draw it as a type nobody defines. */
export async function deleteCalloutType(
  deps: VaultDeps,
  { name }: { name: string },
): Promise<void> {
  await writeCalloutSettings(deps, withoutCalloutType(deps.session.calloutSettings, name));
}

/** Keeps a built-in type out of the menus, or offers it again. */
export async function setBuiltInCalloutHidden(
  deps: VaultDeps,
  change: { name: string; hidden: boolean },
): Promise<void> {
  await writeCalloutSettings(deps, withBuiltInHidden(deps.session.calloutSettings, change));
}

/**
 * Replaces a callouts file that could not be read with an empty one: only
 * when the person asks, as what it held is lost (git's history keeps it).
 */
export async function replaceUnreadableCallouts(deps: VaultDeps): Promise<void> {
  if (deps.session.calloutsProblem === null) return;
  await writeFile(deps, CALLOUTS_PATH, serializeCalloutSettings(NO_CALLOUT_SETTINGS));
}

/** The notes with a callout of the type `name`: what a delete of it would leave drawn as unknown. */
export function notesUsingCalloutType(deps: VaultDeps, name: string): VaultPath[] {
  const paths: VaultPath[] = [];
  for (const file of deps.session.allFiles()) {
    if (isVisibleNote(file.path) && usesCalloutType(file.text, name)) paths.push(file.path);
  }
  return paths.sort();
}
