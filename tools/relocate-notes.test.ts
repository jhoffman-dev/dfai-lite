import { relocate, type VaultInMemory } from './relocate-notes.ts';

const vault = (
  notes: Record<string, string>,
  files: string[] = [],
  favorites: string[] = [],
): VaultInMemory => ({
  notes: new Map(Object.entries(notes)),
  files,
  favorites,
});

describe('relocate', () => {
  it('re-points path links into a moved folder, and leaves name links that still resolve', () => {
    const start = vault({
      'Companies/Acme.md': 'A customer.\n',
      'Projects/Rollout.md': 'For [[Companies/Acme]] and [[Acme|them]].\n',
    });
    const { vault: after, linksRewritten } = relocate(start, [
      { from: 'Companies', to: 'Resources/Companies' },
    ]);
    expect(after.notes.get('Projects/Rollout.md')).toBe(
      'For [[Resources/Companies/Acme]] and [[Acme|them]].\n',
    );
    expect(after.notes.has('Resources/Companies/Acme.md')).toBe(true);
    expect(linksRewritten).toBe(1);
  });

  it('keeps two notes of one name apart: each link still opens the note it opened', () => {
    const start = vault({
      'Companies/HiBob.md': 'The company.\n',
      'Terms/HiBob.md': 'The term.\n',
      'Notes/N.md': '[[Companies/HiBob]] vs [[Terms/HiBob]]\n',
    });
    const { vault: after } = relocate(start, [
      { from: 'Companies', to: 'Resources/Companies' },
      { from: 'Terms', to: 'Resources/Glossary' },
      { from: 'Notes', to: 'Resources/Notes' },
    ]);
    expect(after.notes.get('Resources/Notes/N.md')).toBe(
      '[[Resources/Companies/HiBob]] vs [[Resources/Glossary/HiBob]]\n',
    );
  });

  it('re-points a relative image in a note that moved deeper', () => {
    const start = vault({ 'Notes/Chart.md': '![Q3](../attachments/q3.png)\n' }, [
      'attachments/q3.png',
    ]);
    const { vault: after, imagesRewritten } = relocate(start, [
      { from: 'Notes', to: 'Resources/Notes' },
    ]);
    expect(after.notes.get('Resources/Notes/Chart.md')).toBe('![Q3](../../attachments/q3.png)\n');
    expect(imagesRewritten).toBe(1);
  });

  it('carries files and favorites, and reports where each moved path ended', () => {
    const start = vault(
      { 'artifacts/Guide.md': 'Guide.\n', 'Ship small.md': 'Decision.\n' },
      ['artifacts/guide/page.html'],
      ['Ship small.md', 'artifacts/Guide.md'],
    );
    const { vault: after, moved } = relocate(start, [
      { from: 'artifacts', to: 'Resources/Artifacts' },
      { from: 'Ship small.md', to: 'Resources/Decisions/Ship small.md' },
    ]);
    expect(after.files).toEqual(['Resources/Artifacts/guide/page.html']);
    expect(after.favorites).toEqual([
      'Resources/Decisions/Ship small.md',
      'Resources/Artifacts/Guide.md',
    ]);
    expect(moved.get('artifacts/guide/page.html')).toBe('Resources/Artifacts/guide/page.html');
    expect(moved.get('Ship small.md')).toBe('Resources/Decisions/Ship small.md');
  });

  it('leaves a vault alone when no move applies', () => {
    const start = vault({ 'Inbox/A.md': '[[B]]\n' });
    const result = relocate(start, [{ from: 'Companies', to: 'Resources/Companies' }]);
    expect([...result.vault.notes]).toEqual([...start.notes]);
    expect(result.moved.size).toBe(0);
  });
});
