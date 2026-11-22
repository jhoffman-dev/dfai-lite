import {
  IMPORTS_PATH,
  ledgerAfterDelete,
  ledgerAfterMove,
  parseImportLedger,
  sameLedger,
  serializeImportLedger,
  type ImportLedger,
  type ParsedImportLedger,
} from '../../domain/meetings/index.ts';
import type { PathMove, VaultPath } from '../../domain/vault/index.ts';
import type { VaultSession } from '../session/index.ts';
import { writeFile, type VaultDeps } from './vault-deps.ts';

/**
 * The import ledger cannot be read, so nothing writes it: writing what could
 * be read (nothing) over it would forget every meeting the person deleted.
 * Settings says why and offers the way out; until then imports wait.
 */
export class ImportLedgerUnreadableError extends Error {
  override readonly name = 'ImportLedgerUnreadableError';
}

/** The import ledger as the session holds it; none when the file is missing. */
export function readImportLedger(session: VaultSession): ParsedImportLedger {
  const file = session.file(IMPORTS_PATH);
  return file === null ? { kind: 'ok', ledger: [] } : parseImportLedger(file.text);
}

/** Why the ledger cannot be read, or null when it can (or there is none yet). */
export function importLedgerProblem(session: VaultSession): string | null {
  const parsed = readImportLedger(session);
  return parsed.kind === 'malformed' ? parsed.reason : null;
}

/**
 * Changes the ledger as it is now — read again for every change, so a delete
 * in the app or entries a sync brought meanwhile are kept — and writes it
 * when it says something new. Rejects with {@link ImportLedgerUnreadableError},
 * writing nothing, when the file cannot be read. Returns the ledger as kept.
 */
export async function updateImportLedger(
  deps: VaultDeps,
  change: (ledger: ImportLedger) => ImportLedger,
): Promise<ImportLedger> {
  const current = readImportLedger(deps.session);
  if (current.kind === 'malformed') throw new ImportLedgerUnreadableError(current.reason);
  const next = change(current.ledger);
  if (sameLedger(current.ledger, next)) return current.ledger;
  await writeFile(deps, IMPORTS_PATH, serializeImportLedger(next));
  return next;
}

/** Replaces the ledger whatever it holds: only for the person's own choice in Settings. */
export async function replaceImportLedger(deps: VaultDeps, ledger: ImportLedger): Promise<void> {
  await writeFile(deps, IMPORTS_PATH, serializeImportLedger(ledger));
}

/**
 * The ledger follows a note or folder the app moved, as the favorites do.
 * An unreadable ledger is left as it is: the move goes ahead without it.
 */
export async function followMoveInLedger(deps: VaultDeps, move: PathMove): Promise<void> {
  if (importLedgerProblem(deps.session) !== null) return;
  await updateImportLedger(deps, (ledger) => ledgerAfterMove(ledger, move));
}

/**
 * A meeting note the person deleted is remembered as dismissed, so no import
 * brings it back. An unreadable ledger is left as it is: the delete goes ahead.
 */
export async function followDeleteInLedger(deps: VaultDeps, path: VaultPath): Promise<void> {
  if (importLedgerProblem(deps.session) !== null) return;
  await updateImportLedger(deps, (ledger) => ledgerAfterDelete(ledger, path));
}
