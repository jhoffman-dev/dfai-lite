import { openVault, VaultSession } from '../../application/index.ts';
import { sampleVaultFiles } from './index.ts';

describe('the sample vault', () => {
  it('opens with its notes, a favorite, links that resolve and one that does not yet', async () => {
    const session = new VaultSession();
    const opened = await openVault({ files: sampleVaultFiles(), session });
    expect(opened).toEqual({ noteCount: 13, favoritesProblem: null });
    expect(session.favorites).toContain('Projects/Larkspur Payroll.md');
    expect(session.index.backlinks('People/Mara Quill.md').length).toBeGreaterThan(2);
    expect(session.index.unresolved().map((target) => target.target)).toEqual(['Materials list']);
    expect(session.index.notesWithTag('not-a-tag')).toEqual([]);
  });

  it('holds a picture a note shows, as a PNG', async () => {
    const files = sampleVaultFiles();
    const bytes = await files.readBinary('attachments/Pay runs.png');
    expect([...(bytes ?? []).slice(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });
});
