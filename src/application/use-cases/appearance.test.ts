import { APPEARANCE_PATH } from '../../domain/appearance/index.ts';
import { VaultSession } from '../session/index.ts';
import { MemoryVaultFiles } from '../testing/index.ts';
import { AppearanceUnreadableError } from './appearance.ts';
import {
  applyExternalChanges,
  deleteFolder,
  deleteNote,
  openVault,
  renameFolder,
  renameNote,
  setPathAppearance,
  type VaultDeps,
} from './index.ts';

const PLAN = 'Projects/Larkspur Payroll.md';
const OLD = 'Projects/Archive/Old plan.md';
const MARA = 'People/Mara Quill.md';

async function opened(extra: Record<string, string> = {}) {
  const files = MemoryVaultFiles.of({
    [PLAN]: 'Rollout with [[Mara Quill]].',
    [OLD]: 'Last year.',
    [MARA]: 'Leads payroll.',
    ...extra,
  });
  const deps: VaultDeps & { files: MemoryVaultFiles } = { files, session: new VaultSession() };
  await openVault(deps);
  const write = files.write.bind(files);
  const writes: string[] = [];
  files.write = async (request) => {
    if (request.path === APPEARANCE_PATH) writes.push(request.text);
    await write(request);
  };
  return { deps, files, writes };
}

const onDisk = (files: MemoryVaultFiles) => JSON.parse(files.peek(APPEARANCE_PATH) ?? '{}');

describe('setting a look', () => {
  it('writes the file once per change, and the session draws it', async () => {
    const { deps, files, writes } = await opened();
    await setPathAppearance(deps, { path: 'Projects', color: 'blue' });
    await setPathAppearance(deps, { path: PLAN, icon: 'flag' });
    expect(writes).toHaveLength(2);
    expect(onDisk(files)).toEqual({ Projects: { color: 'blue' }, [PLAN]: { icon: 'flag' } });
    expect(deps.session.resolvedAppearances.get(PLAN)).toEqual({
      hue: null,
      icon: { kind: 'glyph', name: 'flag' },
    });
  });

  it('writes nothing when nothing changed, and nothing to clear a look never set', async () => {
    const { deps, writes } = await opened();
    await setPathAppearance(deps, { path: PLAN, color: null, icon: null });
    expect(writes).toEqual([]);
    await setPathAppearance(deps, { path: PLAN, color: 'red' });
    await setPathAppearance(deps, { path: PLAN, color: 'red' });
    expect(writes).toHaveLength(1);
  });

  it('keeps an unchanged row’s look as the same object, so only the changed row redraws', async () => {
    const { deps } = await opened();
    await setPathAppearance(deps, { path: PLAN, color: 'red' });
    const before = deps.session.resolvedAppearances.get(PLAN);
    await setPathAppearance(deps, { path: MARA, icon: 'person' });
    expect(deps.session.resolvedAppearances.get(PLAN)).toBe(before);
  });

  it('never writes over a file it could not read, and says why', async () => {
    const { deps, files, writes } = await opened({ [APPEARANCE_PATH]: '{oops' });
    expect(deps.session.appearancesProblem).toMatch(/JSON/);
    await expect(setPathAppearance(deps, { path: PLAN, color: 'red' })).rejects.toBeInstanceOf(
      AppearanceUnreadableError,
    );
    await renameNote(deps, { from: PLAN, to: 'Projects/Plan.md' });
    expect(writes).toEqual([]);
    expect(files.peek(APPEARANCE_PATH)).toBe('{oops');
  });

  it('draws the looks again when the vault is opened afresh (a relaunch)', async () => {
    const { deps, files } = await opened();
    await setPathAppearance(deps, { path: 'Projects', color: 'green', icon: 'work' });
    const reopened = { files, session: new VaultSession() };
    await openVault(reopened);
    expect(reopened.session.resolvedAppearances.get('Projects')).toEqual({
      hue: 'green',
      icon: { kind: 'glyph', name: 'work' },
    });
  });

  it('reads the file afresh when it changes on disk (the other Mac synced)', async () => {
    const { deps, files } = await opened();
    files.edit(APPEARANCE_PATH, '{"People": {"color": "green"}}');
    await applyExternalChanges(deps, [APPEARANCE_PATH]);
    expect(deps.session.resolvedAppearances.get('People')?.hue).toBe('green');
  });

  it('keeps the look of a path missing at load: the other Mac may not have synced it yet', async () => {
    const { deps, files } = await opened({
      [APPEARANCE_PATH]: '{"Later/Not here yet.md": {"color": "pink"}}',
    });
    await setPathAppearance(deps, { path: PLAN, color: 'red' });
    expect(onDisk(files)).toHaveProperty(['Later/Not here yet.md']);
  });
});

describe('the looks follow what the app does to notes and folders', () => {
  it('follow a renamed note, in one write', async () => {
    const { deps, files, writes } = await opened();
    await setPathAppearance(deps, { path: PLAN, color: 'red', icon: 'flag' });
    writes.length = 0;
    await renameNote(deps, { from: PLAN, to: 'People/Plan.md' });
    expect(writes).toHaveLength(1);
    expect(onDisk(files)).toEqual({ 'People/Plan.md': { color: 'red', icon: 'flag' } });
  });

  it('follow a moved folder: its own look and the looks under it, in one write', async () => {
    const { deps, files, writes } = await opened();
    await setPathAppearance(deps, { path: 'Projects', color: 'blue' });
    await setPathAppearance(deps, { path: OLD, icon: 'archive' });
    await setPathAppearance(deps, { path: MARA, icon: 'person' });
    writes.length = 0;
    await renameFolder(deps, { from: 'Projects', to: 'Areas/Work' });
    expect(writes).toHaveLength(1);
    expect(onDisk(files)).toEqual({
      'Areas/Work': { color: 'blue' },
      'Areas/Work/Archive/Old plan.md': { icon: 'archive' },
      [MARA]: { icon: 'person' },
    });
  });

  it('drop a deleted note', async () => {
    const { deps, files } = await opened();
    await setPathAppearance(deps, { path: MARA, color: 'green' });
    await setPathAppearance(deps, { path: PLAN, color: 'red' });
    await deleteNote(deps, { path: MARA });
    expect(onDisk(files)).toEqual({ [PLAN]: { color: 'red' } });
  });

  it('drop a deleted folder and what was in it, in one write, keeping what was kept', async () => {
    const { deps, files, writes } = await opened();
    await setPathAppearance(deps, { path: 'Projects', color: 'blue' });
    await setPathAppearance(deps, { path: PLAN, color: 'red' });
    await setPathAppearance(deps, { path: OLD, icon: 'archive' });
    await setPathAppearance(deps, { path: MARA, color: 'green' });
    files.edit(OLD, 'Changed on disk.');
    writes.length = 0;
    const result = await deleteFolder(deps, { path: 'Projects' });
    expect(result).toMatchObject({ kind: 'deleted', kept: [OLD] });
    expect(writes).toHaveLength(1);
    expect(onDisk(files)).toEqual({
      Projects: { color: 'blue' },
      [OLD]: { icon: 'archive' },
      [MARA]: { color: 'green' },
    });
  });

  it('drop a whole folder once nothing in it was kept', async () => {
    const { deps, files } = await opened();
    await setPathAppearance(deps, { path: 'Projects', color: 'blue' });
    await setPathAppearance(deps, { path: 'Projects/Archive', icon: 'archive' });
    await deleteFolder(deps, { path: 'Projects' });
    expect(onDisk(files)).toEqual({});
  });
});
