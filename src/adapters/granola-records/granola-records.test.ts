import { describe, expect, it } from 'vitest';
import { NO_GRANOLA_RECORD } from '../../application/index.ts';
import { MemorySettingsStore } from '../../application/testing/index.ts';
import { parseSettings } from '../settings/index.ts';
import { createGranolaRecords } from './index.ts';

describe('this Mac’s Granola record', () => {
  it('is kept per vault in the settings file, beside the settings, and read back', () => {
    const settings = new MemorySettingsStore();
    const records = createGranolaRecords(settings);
    expect(records.read('/Users/example/Notes')).toEqual(NO_GRANOLA_RECORD);
    const record = {
      automatic: false,
      watermark: '2026-11-17T17:41:03.000Z',
      lastImportAt: '2026-11-20T00:00:00.000Z',
      lastResult: 'Imported 1 meeting.',
    };
    records.write('/Users/example/Notes', record);
    expect(records.read('/Users/example/Notes')).toEqual(record);
    expect(records.read('/Users/example/Other')).toEqual(NO_GRANOLA_RECORD);
    expect(settings.load().captureHotkey).toBe('Alt+Command+N');
  });

  it('survives the settings file’s own round trip, and reads a damaged record as none', () => {
    const settings = new MemorySettingsStore();
    createGranolaRecords(settings).write('/v', { ...NO_GRANOLA_RECORD, watermark: 'w' });
    const reread = new MemorySettingsStore(parseSettings(JSON.stringify(settings.load())));
    expect(createGranolaRecords(reread).read('/v').watermark).toBe('w');
    const damaged = new MemorySettingsStore(
      parseSettings(JSON.stringify({ granola: { '/v': { automatic: 'yes', watermark: 3 } } })),
    );
    expect(createGranolaRecords(damaged).read('/v')).toEqual(NO_GRANOLA_RECORD);
  });
});
