import {
  NO_GRANOLA_RECORD,
  type GranolaRecord,
  type GranolaRecords,
  type Settings,
  type SettingsStore,
} from '../../application/index.ts';

/*
 * This Mac's Granola record for each vault, kept in this Mac's settings file
 * under `granola`, by vault folder: never in the vault, which syncs. The
 * settings parser keeps a field it does not know, so this needs no change
 * to the settings' own shape.
 */

type Fields = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function recordOf(value: unknown): GranolaRecord {
  if (!isRecord(value)) return NO_GRANOLA_RECORD;
  return {
    automatic: typeof value.automatic === 'boolean' ? value.automatic : NO_GRANOLA_RECORD.automatic,
    watermark: textOrNull(value.watermark),
    lastImportAt: textOrNull(value.lastImportAt),
    lastResult: textOrNull(value.lastResult),
    keyRefusedAt: textOrNull(value.keyRefusedAt),
  };
}

type WithGranola = Settings & { readonly granola?: unknown };

const byVault = (settings: WithGranola): Fields =>
  isRecord(settings.granola) ? settings.granola : {};

export function createGranolaRecords(settings: SettingsStore): GranolaRecords {
  return {
    read: (vault) => recordOf(byVault(settings.load())[vault]),
    write(vault, record) {
      const current: WithGranola = settings.load();
      const next: WithGranola = { ...current, granola: { ...byVault(current), [vault]: record } };
      settings.save(next);
    },
  };
}
