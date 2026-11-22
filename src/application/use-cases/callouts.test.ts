import { CALLOUTS_PATH, serializeCalloutSettings } from '../../domain/callouts/index.ts';
import { FileChangedError } from '../ports/index.ts';
import { VaultSession } from '../session/index.ts';
import { MemoryVaultFiles } from '../testing/index.ts';
import {
  applyExternalChanges,
  deleteCalloutType,
  notesUsingCalloutType,
  openVault,
  reloadVault,
  replaceUnreadableCallouts,
  saveCalloutType,
  setBuiltInCalloutHidden,
  UnreadableCalloutsError,
  type VaultDeps,
} from './index.ts';

const COPY = '.dfai-lite/callouts (conflict from Work Mac).json';
const decision = { name: 'decision', label: 'Decision', hue: 'purple', icon: 'flag' } as const;
const DECISION_FILE = serializeCalloutSettings({ types: [decision], hidden: [] });

async function opened(
  extra: Record<string, string> = {},
): Promise<VaultDeps & { files: MemoryVaultFiles }> {
  const files = MemoryVaultFiles.of({
    'Projects/Plan.md': 'Plan.\n\n> [!Decision] Ship it\n> Friday.\n',
    'Inbox/Other.md': 'No callouts.\n',
    ...extra,
  });
  const deps = { files, session: new VaultSession() };
  await openVault(deps);
  return deps;
}

/** Counts the writes the files take, by path. */
function countWrites(files: MemoryVaultFiles): Map<string, number> {
  const writes = new Map<string, number>();
  const write = files.write.bind(files);
  files.write = async (request) => {
    writes.set(request.path, (writes.get(request.path) ?? 0) + 1);
    await write(request);
  };
  return writes;
}

const draft = { name: 'decision', label: 'Decision', hue: 'purple', icon: 'flag' };

describe('saving a callout type', () => {
  it('adds a type with one write of the file, which the session then reads', async () => {
    const deps = await opened();
    const writes = countWrites(deps.files);
    expect(await saveCalloutType(deps, { draft, replacing: null })).toEqual({ kind: 'saved' });
    expect(writes.get(CALLOUTS_PATH)).toBe(1);
    expect(deps.files.peek(CALLOUTS_PATH)).toBe(DECISION_FILE);
    expect(deps.session.calloutSettings.types).toEqual([decision]);
  });

  it('writes nothing for a draft with problems, and says what they are', async () => {
    const deps = await opened();
    const writes = countWrites(deps.files);
    const result = await saveCalloutType(deps, {
      draft: { ...draft, name: 'my type' },
      replacing: null,
    });
    expect(result.kind).toBe('invalid');
    expect(writes.size).toBe(0);
  });

  it('edits a type in place, renamed, with one write', async () => {
    const deps = await opened({ [CALLOUTS_PATH]: DECISION_FILE });
    const writes = countWrites(deps.files);
    await saveCalloutType(deps, {
      draft: { ...draft, name: 'ruling', hue: 'red' },
      replacing: 'decision',
    });
    expect(writes.get(CALLOUTS_PATH)).toBe(1);
    expect(deps.session.calloutSettings.types.map((type) => [type.name, type.hue])).toEqual([
      ['ruling', 'red'],
    ]);
  });

  it('never writes over a file changed on disk since it was read', async () => {
    const deps = await opened({ [CALLOUTS_PATH]: DECISION_FILE });
    deps.files.edit(CALLOUTS_PATH, serializeCalloutSettings({ types: [], hidden: ['bug'] }));
    await expect(
      saveCalloutType(deps, { draft: { ...draft, name: 'idea' }, replacing: null }),
    ).rejects.toBeInstanceOf(FileChangedError);
    expect(deps.files.peek(CALLOUTS_PATH)).toContain('"bug"');
  });
});

describe('deleting a callout type', () => {
  it('writes the file without it and leaves the notes using it untouched', async () => {
    const deps = await opened({ [CALLOUTS_PATH]: DECISION_FILE });
    expect(notesUsingCalloutType(deps, 'decision')).toEqual(['Projects/Plan.md']);
    const plan = deps.files.peek('Projects/Plan.md');
    await deleteCalloutType(deps, { name: 'Decision' });
    expect(deps.session.calloutSettings.types).toEqual([]);
    expect(deps.files.peek('Projects/Plan.md')).toBe(plan);
  });
});

describe('hiding a built-in', () => {
  it('keeps it in the file’s hidden list, and offers it again', async () => {
    const deps = await opened();
    await setBuiltInCalloutHidden(deps, { name: 'bug', hidden: true });
    expect(deps.session.calloutSettings.hidden).toEqual(['bug']);
    await setBuiltInCalloutHidden(deps, { name: 'bug', hidden: false });
    expect(deps.session.calloutSettings.hidden).toEqual([]);
  });
});

describe('a callouts file that cannot be read', () => {
  it('reads as no types with the reason, and is never written over unasked', async () => {
    const deps = await opened({ [CALLOUTS_PATH]: '{ broken' });
    expect(deps.session.calloutSettings.types).toEqual([]);
    expect(deps.session.calloutsProblem).toMatch(/not valid JSON/);
    await expect(saveCalloutType(deps, { draft, replacing: null })).rejects.toBeInstanceOf(
      UnreadableCalloutsError,
    );
    expect(deps.files.peek(CALLOUTS_PATH)).toBe('{ broken');
  });

  it('is replaced by an empty one when the person asks', async () => {
    const deps = await opened({ [CALLOUTS_PATH]: '{ broken' });
    await replaceUnreadableCallouts(deps);
    expect(deps.session.calloutsProblem).toBeNull();
    expect(await saveCalloutType(deps, { draft, replacing: null })).toEqual({ kind: 'saved' });
  });
});

describe('the callouts file changed elsewhere', () => {
  it('is read again when the watcher reports it', async () => {
    const deps = await opened();
    const before = deps.session.calloutSettings;
    deps.files.edit(CALLOUTS_PATH, DECISION_FILE);
    await applyExternalChanges(deps, [CALLOUTS_PATH]);
    expect(deps.session.calloutSettings).not.toBe(before);
    expect(deps.session.calloutSettings.types).toEqual([decision]);
  });

  it('keeps its identity while only notes change', async () => {
    const deps = await opened({ [CALLOUTS_PATH]: DECISION_FILE });
    const before = deps.session.calloutSettings;
    deps.files.edit('Inbox/Other.md', 'Changed.\n');
    await applyExternalChanges(deps, ['Inbox/Other.md']);
    expect(deps.session.calloutSettings).toBe(before);
  });

  it('merges a conflict copy’s types after a sync, then folds them in on the next save', async () => {
    const theirs = serializeCalloutSettings({
      types: [{ name: 'idea', label: null, hue: 'yellow', icon: 'lightbulb' }],
      hidden: [],
    });
    const deps = await opened({ [CALLOUTS_PATH]: DECISION_FILE });
    deps.files.edit(COPY, theirs);
    await reloadVault(deps);
    expect(deps.session.calloutCopies).toEqual([COPY]);
    expect(deps.session.calloutSettings.types.map((type) => type.name)).toEqual([
      'decision',
      'idea',
    ]);

    await setBuiltInCalloutHidden(deps, { name: 'quote', hidden: true });
    expect(deps.files.peek(CALLOUTS_PATH)).toContain('"idea"');
    expect(deps.files.peek(COPY)).toBeUndefined();
    expect(deps.session.calloutCopies).toEqual([]);
    expect(deps.session.calloutSettings.types.map((type) => type.name)).toEqual([
      'decision',
      'idea',
    ]);
  });
});
