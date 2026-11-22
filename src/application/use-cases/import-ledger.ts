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

/** The import ledger as the session holds it; none when the file is missing. */
export function readImportLedger(session: VaultSession): ParsedImportLedger {
  const file = session.file(IMPORTS_PATH);
  return file === null ? { kind: 'ok', ledger: [] } : parseImportLedger(file.text);
}

/**
 * Writes the ledger when it says something new. A malformed file is
 * replaced: what it held could not be read, and the notes' `- Source:` lines
 * stand in for it.
 */
export async function writeImportLedger(deps: VaultDeps, ledger: ImportLedger): Promise<void> {
  const current = readImportLedger(deps.session);
  if (current.kind === 'ok' && sameLedger(current.ledger, ledger)) return;
  await writeFile(deps, IMPORTS_PATH, serializeImportLedger(ledger));
}

/** The ledger follows a note or folder the app moved, as the favorites do. */
export async function followMoveInLedger(deps: VaultDeps, move: PathMove): Promise<void> {
  const { ledger } = readImportLedger(deps.session);
  await writeImportLedger(deps, ledgerAfterMove(ledger, move));
}

/** A meeting note the person deleted is remembered as dismissed, so no import brings it back. */
export async function followDeleteInLedger(deps: VaultDeps, path: VaultPath): Promise<void> {
  const { ledger } = readImportLedger(deps.session);
  await writeImportLedger(deps, ledgerAfterDelete(ledger, path));
}
