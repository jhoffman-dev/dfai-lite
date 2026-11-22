import type { VaultPath } from '../../domain/vault/index.ts';

/**
 * Deletions the person said yes to: a sync that would delete many notes
 * stops and asks (see `deletionsToConfirm`), and goes on only once every
 * one of them is approved here. A commit spends the approval.
 */
export interface DeletionApprovals {
  approve(paths: readonly VaultPath[]): void;
  covers(paths: readonly VaultPath[]): boolean;
  clear(): void;
}

export function createDeletionApprovals(): DeletionApprovals {
  let approved = new Set<VaultPath>();
  return {
    approve: (paths) => {
      approved = new Set([...approved, ...paths]);
    },
    covers: (paths) => paths.every((path) => approved.has(path)),
    clear: () => {
      approved = new Set();
    },
  };
}
