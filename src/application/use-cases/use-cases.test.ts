import { FAVORITES_PATH } from '../../domain/favorites/index.ts';
import { TrashRefusedError } from '../ports/index.ts';
import { VaultSession, type VaultChange } from '../session/index.ts';
import { FixedClock, MemoryVaultFiles } from '../testing/index.ts';
import {
  applyExternalChanges,
  createNoteFromLink,
  createQuickNote,
  deleteNote,
  openVault,
  renameFolder,
  renameNote,
  reorderFavorite,
  saveNoteText,
  toggleFavoriteNote,
  type VaultDeps,
} from './index.ts';

const MARA = 'People/Mara Quill.md';
const PLAN = 'Projects/Larkspur Payroll.md';

async function opened(
  extra: Record<string, string> = {},
): Promise<VaultDeps & { files: MemoryVaultFiles }> {
  const files = MemoryVaultFiles.of(
    {
      [MARA]: 'Leads payroll. #person',
      [PLAN]: 'Rollout with [[Mara Quill|Mara]] and [[People/Mara Quill]].',
      'Inbox/Untitled.md': '',
      [FAVORITES_PATH]: JSON.stringify([MARA]),
      ...extra,
    },
    // A note that is not UTF-8: listed, not read, and its name still taken.
    ['Inbox/Untitled 2.md'],
  );
  const deps = { files, session: new VaultSession() };
  await openVault(deps);
  return deps;
}

describe('opening the vault', () => {
  it('loads every file in one read and indexes the visible notes', async () => {
    const files = MemoryVaultFiles.of({ [MARA]: '', '_index/README.md': '' });
    const session = new VaultSession();
    expect(await openVault({ files, session })).toEqual({ noteCount: 1, favoritesProblem: null });
    expect(session.file('_index/README.md')).not.toBeNull();
  });

  it('reports a malformed favorites file', async () => {
    const deps = await opened({ [FAVORITES_PATH]: 'nope' });
    expect(deps.session.favorites).toEqual([]);
    expect(deps.session.favoritesProblem).toMatch(/JSON/);
  });
});

describe('creating notes', () => {
  it('makes a quick note in the Inbox with a free name, on disk', async () => {
    const deps = await opened();
    const path = await createQuickNote(deps);
    expect(path).toBe('Inbox/Untitled 3.md');
    expect(deps.files.peek(path)).toBe('');
    expect(deps.session.folderTree().folders.map((folder) => folder.name)).toContain('Inbox');
  });

  it('makes a quick note in another folder when one is given', async () => {
    const deps = await opened();
    expect(await createQuickNote(deps, { folder: 'People' })).toBe('People/Untitled.md');
  });

  it('never writes over a file that appeared on disk unseen', async () => {
    const deps = await opened();
    deps.files.edit('People/Untitled.md', 'Made by Claude.');
    await expect(createQuickNote(deps, { folder: 'People' })).rejects.toThrow(/exists/);
    expect(deps.files.peek('People/Untitled.md')).toBe('Made by Claude.');
  });

  it('makes a note from a link, or opens the one that answers', async () => {
    const deps = await opened();
    expect(await createNoteFromLink(deps, { target: 'Tobias Fenn' })).toMatchObject({
      kind: 'create',
      path: 'Inbox/Tobias Fenn.md',
    });
    expect(deps.session.index.resolve('Tobias Fenn')).toBe('Inbox/Tobias Fenn.md');
    expect(await createNoteFromLink(deps, { target: 'mara quill' })).toEqual({
      kind: 'existing',
      path: MARA,
    });
  });
});

describe('saving a note', () => {
  it('writes the text to disk and updates the index', async () => {
    const deps = await opened();
    const changes: VaultChange[] = [];
    deps.session.subscribe((change) => changes.push(change));
    await saveNoteText(deps, { path: MARA, text: 'New #tag' });
    expect(deps.files.peek(MARA)).toBe('New #tag');
    expect(deps.session.index.notesWithTag('tag')).toEqual([MARA]);
    expect(changes).toEqual([{ kind: 'written', path: MARA }]);
  });

  it('does nothing when the text is unchanged', async () => {
    const deps = await opened();
    const before = deps.session.version;
    await saveNoteText(deps, { path: MARA, text: 'Leads payroll. #person' });
    expect(deps.session.version).toBe(before);
  });

  it('saves over the note when it is still the text the editor started from', async () => {
    const deps = await opened();
    const result = await saveNoteText(deps, {
      path: MARA,
      text: 'Typed.',
      basedOnText: 'Leads payroll. #person',
      clock: new FixedClock(),
    });
    expect(result).toEqual({ kind: 'saved', path: MARA });
    expect(deps.files.peek(MARA)).toBe('Typed.');
  });

  it('forks the editor’s text to a conflict copy when the note changed underneath it', async () => {
    const deps = await opened();
    // Claude edited the note while the editor still held the old text, and the session heard.
    deps.files.edit(MARA, 'Edited elsewhere.');
    await applyExternalChanges(deps, [MARA]);
    const result = await saveNoteText(deps, {
      path: MARA,
      text: 'Typed here.',
      basedOnText: 'Leads payroll. #person',
      clock: new FixedClock(new Date(2026, 10, 21, 9, 0)),
    });
    const copy = 'People/Mara Quill (conflict 2026-11-21).md';
    expect(result).toEqual({ kind: 'forked', path: copy, keptPath: MARA });
    expect(deps.files.peek(MARA)).toBe('Edited elsewhere.');
    expect(deps.files.peek(copy)).toBe('Typed here.');
  });

  it('forks too when the disk changed before the session heard', async () => {
    const deps = await opened();
    deps.files.edit(MARA, 'Edited elsewhere.');
    const result = await saveNoteText(deps, {
      path: MARA,
      text: 'Typed here.',
      basedOnText: 'Leads payroll. #person',
      clock: new FixedClock(new Date(2026, 10, 21, 9, 0)),
    });
    expect(result).toMatchObject({ kind: 'forked', keptPath: MARA });
    expect(deps.files.peek(MARA)).toBe('Edited elsewhere.');
    expect(deps.session.file(MARA)?.text).toBe('Edited elsewhere.');
  });

  it('refuses a save with no base over a note changed on disk', async () => {
    const deps = await opened();
    deps.files.edit(MARA, 'Edited elsewhere.');
    await expect(saveNoteText(deps, { path: MARA, text: 'Mine.' })).rejects.toThrow(/changed/);
    expect(deps.files.peek(MARA)).toBe('Edited elsewhere.');
  });
});

describe('changes made on disk by someone else', () => {
  it('reads a changed note afresh, drops a deleted one, and ignores git’s own files', async () => {
    const deps = await opened();
    deps.files.edit(PLAN, 'Rewritten by Claude.');
    deps.files.drop(MARA);
    const changed = await applyExternalChanges(deps, [PLAN, MARA, '.git/index', '.DS_Store']);
    expect(changed.sort()).toEqual([MARA, PLAN]);
    expect(deps.session.file(PLAN)?.text).toBe('Rewritten by Claude.');
    expect(deps.session.file(MARA)).toBeNull();
  });

  it('changes nothing for a file the app wrote itself', async () => {
    const deps = await opened();
    await saveNoteText(deps, { path: MARA, text: 'Mine.' });
    const before = deps.session.version;
    expect(await applyExternalChanges(deps, [MARA])).toEqual([]);
    expect(deps.session.version).toBe(before);
  });

  it('reads the whole vault when a folder moved', async () => {
    const deps = await opened();
    deps.files.edit('Work/Plan.md', 'Moved in by git.');
    deps.files.drop(PLAN);
    await applyExternalChanges(deps, ['Work', 'Projects']);
    expect(deps.session.file('Work/Plan.md')?.text).toBe('Moved in by git.');
    expect(deps.session.file(PLAN)).toBeNull();
  });
});

describe('renaming a note', () => {
  it('moves the file, rewrites links to it, and follows it in favorites', async () => {
    const deps = await opened();
    const result = await renameNote(deps, { from: MARA, to: 'Contacts/Mara Q.md' });
    expect(result).toEqual({ kind: 'renamed', path: 'Contacts/Mara Q.md', retargeted: 2 });
    expect(deps.session.file(PLAN)?.text).toBe(
      'Rollout with [[Mara Q|Mara]] and [[Contacts/Mara Q]].',
    );
    expect(deps.files.peek(PLAN)).toBe('Rollout with [[Mara Q|Mara]] and [[Contacts/Mara Q]].');
    expect(deps.session.file(MARA)).toBeNull();
    expect(deps.files.peek(MARA)).toBeUndefined();
    expect(deps.files.peek('Contacts/Mara Q.md')).toBe('Leads payroll. #person');
    expect(deps.session.favorites).toEqual(['Contacts/Mara Q.md']);
    expect(deps.session.index.backlinks('Contacts/Mara Q.md')).toEqual([PLAN]);
  });

  it('refuses a taken path, case aside, and a forbidden name', async () => {
    const deps = await opened();
    expect(
      await renameNote(deps, { from: MARA, to: 'projects/larkspur payroll.md' }),
    ).toMatchObject({ kind: 'refused' });
    expect(await renameNote(deps, { from: MARA, to: 'People/Mara: Q.md' })).toMatchObject({
      kind: 'refused',
    });
    expect(await renameNote(deps, { from: 'Nope.md', to: 'X.md' })).toMatchObject({
      kind: 'refused',
    });
    expect(deps.session.file(MARA)).not.toBeNull();
  });
});

describe('renaming a folder', () => {
  it('moves every note under it, rewriting links and favorites', async () => {
    const deps = await opened({ 'People/Team/Tobias Fenn.md': 'See [[People/Mara Quill]].' });
    expect(await renameFolder(deps, { from: 'People', to: 'Contacts' })).toEqual({
      kind: 'renamed',
      moved: 2,
      retargeted: 2,
    });
    expect(deps.session.index.paths()).toContain('Contacts/Team/Tobias Fenn.md');
    expect(deps.session.file(PLAN)?.text).toContain('[[Contacts/Mara Quill]]');
    expect(deps.files.peek('Contacts/Team/Tobias Fenn.md')).toBe('See [[Contacts/Mara Quill]].');
    expect(deps.session.favorites).toEqual(['Contacts/Mara Quill.md']);
  });

  it('refuses a clash, or a move into itself, before anything moves', async () => {
    const deps = await opened({ 'Contacts/Mara Quill.md': '' });
    expect(await renameFolder(deps, { from: 'People', to: 'contacts' })).toMatchObject({
      kind: 'refused',
      reason: expect.stringMatching(/already at/),
    });
    expect(await renameFolder(deps, { from: 'People', to: 'People/Old' })).toMatchObject({
      kind: 'refused',
    });
    expect(deps.session.file(MARA)).not.toBeNull();
  });
});

describe('deleting a note', () => {
  it('moves it to the Trash and drops it from the index and the favorites', async () => {
    const deps = await opened();
    await deleteNote(deps, { path: MARA });
    expect(deps.files.trashed).toEqual([MARA]);
    expect(deps.session.index.resolve('Mara Quill')).toBeNull();
    expect(deps.session.favorites).toEqual([]);
    expect(deps.files.peek(FAVORITES_PATH)).toBe('[]\n');
  });
});

describe('deleting a note that changed, or that the Trash refuses', () => {
  it('deletes nothing when the note changed on disk since it was seen, and reads it afresh', async () => {
    const deps = await opened();
    deps.files.edit(MARA, 'Claude added a line.');
    await expect(deleteNote(deps, { path: MARA })).rejects.toThrow(/not deleted/);
    expect(deps.files.peek(MARA)).toBe('Claude added a line.');
    expect(deps.session.file(MARA)?.text).toBe('Claude added a line.');
  });

  it('says so when the Trash refuses, and deletes for good only when asked', async () => {
    const deps = await opened();
    deps.files.trashRefuses = true;
    await expect(deleteNote(deps, { path: MARA })).rejects.toBeInstanceOf(TrashRefusedError);
    expect(deps.files.peek(MARA)).toBe('Leads payroll. #person');
    await deleteNote(deps, { path: MARA, permanently: true });
    expect(deps.files.peek(MARA)).toBeUndefined();
  });
});

describe('favorites', () => {
  it('toggles and reorders through the vault file', async () => {
    const deps = await opened();
    await toggleFavoriteNote(deps, { path: PLAN });
    await reorderFavorite(deps, { path: PLAN, index: 0 });
    expect(deps.session.favorites).toEqual([PLAN, MARA]);
    expect(deps.files.peek(FAVORITES_PATH)).toBe(`[\n  "${PLAN}",\n  "${MARA}"\n]\n`);
    await toggleFavoriteNote(deps, { path: MARA });
    expect(deps.session.favorites).toEqual([PLAN]);
  });
});
