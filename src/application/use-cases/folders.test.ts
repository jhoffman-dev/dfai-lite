import { buildAiIndex } from '../../domain/ai-index/index.ts';
import { FAVORITES_PATH } from '../../domain/favorites/index.ts';
import { TrashRefusedError } from '../ports/index.ts';
import { VaultSession } from '../session/index.ts';
import { MemoryVaultFiles } from '../testing/index.ts';
import {
  createFolder,
  deleteFolder,
  isEmptyFolder,
  moveFolderInto,
  moveNoteInto,
  openVault,
  type VaultDeps,
} from './index.ts';

const MARA = 'People/Mara Quill.md';
const IDEA = 'Inbox/Payroll idea.md';
const PLAN = 'Projects/Larkspur Payroll.md';

async function opened(
  extra: Record<string, string> = {},
  others: string[] = [],
): Promise<VaultDeps & { files: MemoryVaultFiles }> {
  const files = MemoryVaultFiles.of(
    {
      [MARA]: 'Leads payroll.',
      [IDEA]: 'Ask [[Mara Quill]].',
      [PLAN]: 'Rollout, see [[Payroll idea]] and [[Inbox/Payroll idea]].',
      [FAVORITES_PATH]: JSON.stringify([IDEA]),
      ...extra,
    },
    others,
  );
  const deps = { files, session: new VaultSession() };
  await openVault(deps);
  return deps;
}

const folderNames = (deps: VaultDeps) => deps.session.folderTree().folders.map((f) => f.name);

describe('creating a folder', () => {
  it('makes an empty folder with a keep file, shown in the tree and kept across a reopen', async () => {
    const deps = await opened();
    expect(await createFolder(deps, { path: 'Areas/Garden' })).toEqual({
      kind: 'created',
      path: 'Areas/Garden',
    });
    expect(folderNames(deps)).toContain('Areas');
    const reopened = { files: deps.files, session: new VaultSession() };
    await openVault(reopened);
    const areas = reopened.session.folderTree().folders.find((f) => f.name === 'Areas');
    expect(areas?.folders.map((f) => f.path)).toEqual(['Areas/Garden']);
    expect(areas?.noteCount).toBe(0);
    expect((await deps.files.readAll()).otherPaths).toContain('Areas/Garden/.gitkeep');
  });

  it('hides the keep file from the tree, the notes and the AI index', async () => {
    const deps = await opened();
    await createFolder(deps, { path: 'Areas' });
    expect(deps.session.index.paths().some((path) => path.includes('.gitkeep'))).toBe(false);
    expect(deps.session.folderTree().folders.find((f) => f.name === 'Areas')?.notes).toEqual([]);
    const index = buildAiIndex([...deps.session.allFiles()]);
    expect(index.some((file) => file.text.includes('.gitkeep'))).toBe(false);
  });

  it('refuses a bad name, a dot name, the index folder and a clash, case aside', async () => {
    const deps = await opened();
    for (const path of ['', 'A:B', '.hidden', 'Areas/.x', '_index', 'people', 'Inbox']) {
      expect(await createFolder(deps, { path }), path).toMatchObject({ kind: 'refused' });
    }
    expect((await deps.files.readAll()).otherPaths).toEqual([]);
  });

  it('passes on a clash the disk knows of and the session does not', async () => {
    const deps = await opened();
    await deps.files.createFolder('Later');
    expect(await createFolder(deps, { path: 'Later' })).toMatchObject({ kind: 'refused' });
  });
});

describe('moving a note into a folder', () => {
  it('moves it through renameNote: links in other notes and the favorites follow', async () => {
    const deps = await opened();
    await createFolder(deps, { path: 'Projects/Payroll' });
    const result = await moveNoteInto(deps, { path: IDEA, folder: 'Projects/Payroll' });
    expect(result).toMatchObject({ kind: 'renamed', path: 'Projects/Payroll/Payroll idea.md' });
    expect(deps.session.file(IDEA)).toBeNull();
    expect(deps.files.peek(PLAN)).toContain('[[Projects/Payroll/Payroll idea]]');
    expect(deps.session.index.resolve('Payroll idea')).toBe('Projects/Payroll/Payroll idea.md');
    expect(deps.session.favorites).toEqual(['Projects/Payroll/Payroll idea.md']);
  });

  it('leaves the emptied folder in place, as the disk does', async () => {
    const deps = await opened();
    await moveNoteInto(deps, { path: IDEA, folder: '' });
    expect(folderNames(deps)).toContain('Inbox');
    expect(isEmptyFolder(deps.session, 'Inbox')).toBe(true);
  });

  it('refuses a name already taken there, case aside, and moves nothing', async () => {
    const deps = await opened({ 'People/payroll IDEA.md': '' });
    const result = await moveNoteInto(deps, { path: IDEA, folder: 'People' });
    expect(result).toMatchObject({ kind: 'refused', reason: expect.stringMatching(/already/) });
    expect(deps.files.peek(IDEA)).toBe('Ask [[Mara Quill]].');
  });

  it('does nothing when the note is already in the folder', async () => {
    const deps = await opened();
    expect(await moveNoteInto(deps, { path: IDEA, folder: 'Inbox' })).toEqual({
      kind: 'renamed',
      path: IDEA,
      retargeted: 0,
    });
  });
});

describe('moving a folder into a folder', () => {
  it('moves its notes and its empty folders, and removes the emptied old one', async () => {
    const deps = await opened();
    await createFolder(deps, { path: 'People/Archive' });
    expect(await moveFolderInto(deps, { path: 'People', folder: 'Projects' })).toMatchObject({
      kind: 'renamed',
      moved: 1,
    });
    expect(deps.session.file('Projects/People/Mara Quill.md')).not.toBeNull();
    expect(deps.session.folders()).toContain('Projects/People/Archive');
    expect(deps.session.folders()).not.toContain('People');
    expect(deps.files.folders()).not.toContain('People');
    expect(deps.files.peek(IDEA)).toBe('Ask [[Mara Quill]].');
  });

  it('refuses a move into itself and a folder already at the new path', async () => {
    const deps = await opened();
    await createFolder(deps, { path: 'People/Team' });
    await createFolder(deps, { path: 'Projects/people' });
    expect(await moveFolderInto(deps, { path: 'People', folder: 'People/Team' })).toMatchObject({
      kind: 'refused',
    });
    expect(await moveFolderInto(deps, { path: 'People', folder: 'Projects' })).toMatchObject({
      kind: 'refused',
      reason: expect.stringMatching(/already at/),
    });
    expect(deps.session.file(MARA)).not.toBeNull();
  });
});

describe('deleting a folder', () => {
  it('removes an empty folder and its keep file', async () => {
    const deps = await opened();
    await createFolder(deps, { path: 'Areas' });
    expect(await deleteFolder(deps, { path: 'Areas' })).toEqual({ kind: 'deleted', notes: 0 });
    expect(deps.files.folders()).not.toContain('Areas');
    expect(folderNames(deps)).not.toContain('Areas');
  });

  it('sends each note to the Trash one by one, then removes the folders', async () => {
    const deps = await opened({ 'People/Team/Tobias Fenn.md': '' });
    expect(await deleteFolder(deps, { path: 'People' })).toEqual({ kind: 'deleted', notes: 2 });
    expect(deps.files.trashed).toEqual([MARA, 'People/Team/Tobias Fenn.md']);
    expect(deps.files.folders()).not.toContain('People');
  });

  it('refuses a folder holding files that are not notes, before deleting anything', async () => {
    const deps = await opened({}, ['People/photo.png']);
    expect(await deleteFolder(deps, { path: 'People' })).toMatchObject({
      kind: 'refused',
      reason: expect.stringMatching(/photo\.png/),
    });
    expect(deps.files.trashed).toEqual([]);
  });

  it('passes on a Trash that refuses, leaving the folder', async () => {
    const deps = await opened();
    deps.files.trashRefuses = true;
    await expect(deleteFolder(deps, { path: 'People' })).rejects.toBeInstanceOf(TrashRefusedError);
    expect(deps.files.folders()).toContain('People');
    expect(await deleteFolder(deps, { path: 'People', permanently: true })).toMatchObject({
      kind: 'deleted',
    });
  });
});
