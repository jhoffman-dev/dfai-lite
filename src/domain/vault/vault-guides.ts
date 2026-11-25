import type { VaultPath } from './note-path.ts';

/** The vault's own guides at its root, and the report a migration left: about the vault, not notes in it. */
const VAULT_GUIDES: ReadonlySet<VaultPath> = new Set([
  'CLAUDE.md',
  'README.md',
  'MIGRATION-REPORT.md',
]);

/** Whether a path is one of the vault's guides, which the index and search leave out. */
export function isVaultGuide(path: VaultPath): boolean {
  return VAULT_GUIDES.has(path);
}
