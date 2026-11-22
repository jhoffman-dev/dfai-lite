// The sync use-case against real git: a bare "remote" in a temp folder and
// two clones, "this Mac" and "the other Mac", each with its own session.
// HOME and git's global config are the test's own, so it runs the same here
// and on Linux CI.
import { mkdir, mkdtemp, readFile, rename, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyExternalChanges,
  createDeletionApprovals,
  createSyncNow,
  createWriteGate,
  deleteNote,
  gatedVaultFiles,
  openVault,
  renameNote,
  saveNoteText,
  VaultSession,
  type GitPort,
  type DeletionApprovals,
  type SyncResult,
  type SyncTimers,
  type VaultDeps,
  type WriteGate,
} from '../src/application/index.ts';
import { buildAiIndex } from '../src/domain/ai-index/index.ts';
import { NodeGit, runGit } from './testing/node-git.ts';
import { NodeVaultFiles } from './testing/node-vault-files.ts';

interface Mac {
  readonly dir: string;
  /** The folder as sync sees it. */
  readonly files: NodeVaultFiles;
  /** What the editor and every use-case use: the folder behind the sync's gate. */
  readonly deps: VaultDeps;
  readonly git: NodeGit;
  readonly gate: WriteGate;
  readonly approvals: DeletionApprovals;
  sync(git?: GitPort): Promise<SyncResult>;
  /** Saves a note as the editor does. */
  write(path: string, text: string): Promise<void>;
  read(path: string): Promise<string | null>;
}

let root: string;
let env: NodeJS.ProcessEnv;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runGit(cwd, args, env);
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

const realTimers: SyncTimers = {
  after(ms, run) {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  },
};

async function macAt(dir: string, name: string): Promise<Mac> {
  const files = new NodeVaultFiles(dir);
  const session = new VaultSession();
  const gate = createWriteGate({ timers: realTimers });
  const approvals = createDeletionApprovals();
  const deps = { files: gatedVaultFiles(files, gate), session };
  await openVault(deps);
  const nodeGit = new NodeGit({ cwd: dir, env, mac: name });
  const syncWith = (port: GitPort) =>
    createSyncNow({
      ...{ files, session, gate, approvals },
      git: port,
      mac: name,
      derivedFiles: buildAiIndex,
    })();
  return {
    dir,
    files,
    deps,
    gate,
    approvals,
    git: nodeGit,
    sync: (port = nodeGit) => syncWith(port),
    write: async (path, text) => void (await saveNoteText(deps, { path, text })),
    read: (path) => files.read(path),
  };
}

async function clone(name: string, folder: string): Promise<Mac> {
  await git(root, 'clone', '--quiet', 'remote.git', folder);
  return macAt(join(root, folder), name);
}

/** The text of a file on the remote's main branch, or null. */
async function onRemote(path: string): Promise<string | null> {
  const result = await runGit(join(root, 'remote.git'), ['show', `main:${path}`], env);
  return result.code === 0 ? result.stdout : null;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dfai-lite-sync-'));
  const home = join(root, 'home');
  await mkdir(home);
  const config = join(home, '.gitconfig');
  await writeFile(
    config,
    '[user]\n\tname = Mara Quill\n\temail = mara@example.com\n[init]\n\tdefaultBranch = main\n',
  );
  env = {
    PATH: process.env['PATH'],
    HOME: home,
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
  await git(root, 'init', '--quiet', '--bare', '-b', 'main', 'remote.git');
  const seed = join(root, 'seed');
  await git(root, 'clone', '--quiet', 'remote.git', 'seed');
  await mkdir(join(seed, 'People'));
  await writeFile(join(seed, 'People', 'Mara Quill.md'), 'Leads payroll.\n');
  await writeFile(join(seed, 'Welcome.md'), 'Hello.\n');
  await git(seed, 'add', '--all');
  await git(seed, 'commit', '--quiet', '-m', 'Vault: start');
  await git(seed, 'push', '--quiet', '-u', 'origin', 'main');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const MARA = 'People/Mara Quill.md';

/** The paths on the remote's main branch. */
async function remotePaths(): Promise<string[]> {
  const listed = await git(join(root, 'remote.git'), 'ls-tree', '-r', '-z', '--name-only', 'main');
  return listed.split('\0').filter(Boolean);
}

/** A git port that runs `after` once the command of `kind` has run, as if someone acted just then. */
function actingAfter(mac: Mac, kind: string, after: () => Promise<void>): GitPort {
  let acted = false;
  return {
    macName: () => mac.git.macName(),
    run: async (command) => {
      const result = await mac.git.run(command);
      if (command.kind === kind && !acted) {
        acted = true;
        await after();
      }
      return result;
    },
  };
}

// Real git on a busy Mac can take a few seconds a test.
describe('sync with real git', { timeout: 30_000 }, () => {
  it('pushes this Mac’s edit in one commit named for the note, with a fresh index', async () => {
    const here = await clone('Studio', 'here');
    await here.write(MARA, 'Leads payroll at Larkspur.\n');
    const result = await here.sync();
    expect(result).toMatchObject({ kind: 'synced', committed: true, pushed: true });
    expect(await onRemote(MARA)).toBe('Leads payroll at Larkspur.\n');
    expect(await onRemote('_index/README.md')).not.toBeNull();
    const log = await git(join(root, 'remote.git'), 'log', '-1', '--format=%B', 'main');
    expect(log).toBe('Notes: Mara Quill\n\nFrom: Studio\n\n');
  });

  it('pulls the other Mac’s edit into the folder and the session', async () => {
    const here = await clone('Studio', 'here');
    const there = await clone('Laptop', 'there');
    await there.write('Inbox/Idea.md', 'From the laptop.\n');
    await there.sync();
    const result = await here.sync();
    expect(result).toMatchObject({ kind: 'synced', pulled: true });
    expect(await here.read('Inbox/Idea.md')).toBe('From the laptop.\n');
    expect(here.deps.session.file('Inbox/Idea.md')?.text).toBe('From the laptop.\n');
  });

  it('keeps both when both Macs changed a note: this Mac’s in place, the other’s beside it', async () => {
    const here = await clone('Studio', 'here');
    const there = await clone('Laptop', 'there');
    await there.write(MARA, 'Edited on the laptop.\n');
    await there.sync();
    await here.write(MARA, 'Edited in the studio.\n');
    const result = await here.sync();
    const copy = 'People/Mara Quill (conflict from Laptop).md';
    expect(result).toMatchObject({
      kind: 'synced',
      pushed: true,
      conflicts: [{ path: MARA, copy }],
    });
    expect(await here.read(MARA)).toBe('Edited in the studio.\n');
    expect(await here.read(copy)).toBe('Edited on the laptop.\n');
    expect(here.deps.session.file(copy)?.text).toBe('Edited on the laptop.\n');
    expect(await onRemote(MARA)).toBe('Edited in the studio.\n');
    expect(await onRemote(copy)).toBe('Edited on the laptop.\n');
    expect(await git(here.dir, 'status', '--porcelain')).toBe('');
  });

  it('never lets a delete here beat an edit there', async () => {
    const here = await clone('Studio', 'here');
    const there = await clone('Laptop', 'there');
    await there.write(MARA, 'Still needed.\n');
    await there.sync();
    await deleteNote(here.deps, { path: MARA });
    expect(await here.sync()).toMatchObject({ kind: 'synced', conflicts: [] });
    expect(await here.read(MARA)).toBe('Still needed.\n');
    expect(await onRemote(MARA)).toBe('Still needed.\n');
  });

  it('never lets a delete there beat an edit here', async () => {
    const here = await clone('Studio', 'here');
    const there = await clone('Laptop', 'there');
    await deleteNote(there.deps, { path: MARA });
    await there.sync();
    await here.write(MARA, 'Still needed here.\n');
    expect(await here.sync()).toMatchObject({ kind: 'synced', conflicts: [] });
    expect(await here.read(MARA)).toBe('Still needed here.\n');
    expect(await onRemote(MARA)).toBe('Still needed here.\n');
  });

  it('settles an _index/ conflict by writing the index afresh from the merged notes', async () => {
    const here = await clone('Studio', 'here');
    const there = await clone('Laptop', 'there');
    await there.write('People/Tobias Fenn.md', 'Engineering lead. #person\n');
    await there.sync();
    await here.write('People/Larkspur contact.md', 'Payroll desk. #person\n');
    const result = await here.sync();
    expect(result).toMatchObject({ kind: 'synced', conflicts: [] });
    const { notes } = await here.files.readAll();
    const index = notes.filter(({ path }) => path.startsWith('_index/'));
    expect(index.length).toBeGreaterThan(0);
    for (const { text } of index) expect(text).not.toContain('<<<<<<<');
    const fresh = buildAiIndex(notes.filter(({ path }) => !path.startsWith('_index/')));
    expect(index).toEqual(fresh);
    expect(await git(here.dir, 'status', '--porcelain')).toBe('');
  });

  it('fetches, merges and pushes again when the push is refused', async () => {
    const here = await clone('Studio', 'here');
    const there = await clone('Laptop', 'there');
    await here.write('Inbox/Here.md', 'Studio.\n');
    await there.write('Inbox/There.md', 'Laptop.\n');
    let raced = false;
    // The other Mac pushes between this Mac's fetch and its push.
    const racing: GitPort = {
      macName: () => here.git.macName(),
      run: async (command) => {
        if (command.kind === 'push' && !raced) {
          raced = true;
          await there.sync();
        }
        return here.git.run(command);
      },
    };
    const result = await here.sync(racing);
    expect(raced).toBe(true);
    expect(result).toMatchObject({ kind: 'synced', pushed: true });
    expect(here.git.ran.filter(({ kind }) => kind === 'push')).toHaveLength(2);
    expect(await onRemote('Inbox/Here.md')).toBe('Studio.\n');
    expect(await onRemote('Inbox/There.md')).toBe('Laptop.\n');
  });

  it('keeps the commit and says unreachable when the remote is gone, then pushes it later', async () => {
    const here = await clone('Studio', 'here');
    await rename(join(root, 'remote.git'), join(root, 'away.git'));
    await here.write(MARA, 'Written offline.\n');
    expect(await here.sync()).toMatchObject({ kind: 'failed', reason: 'unreachable' });
    expect(await git(here.dir, 'log', '-1', '--format=%s')).toBe('Notes: Mara Quill\n');
    await rename(join(root, 'away.git'), join(root, 'remote.git'));
    expect(await here.sync()).toMatchObject({ kind: 'synced', pushed: true });
    expect(await onRemote(MARA)).toBe('Written offline.\n');
  });

  it('is off, and touches nothing, in a folder that is not a repository or has no remote', async () => {
    const plain = join(root, 'plain');
    await mkdir(plain);
    await writeFile(join(plain, 'Note.md'), 'Just a folder.\n');
    const folder = await macAt(plain, 'Studio');
    expect(await folder.sync()).toMatchObject({ kind: 'off', reason: 'not-a-repo' });
    await git(plain, 'init', '--quiet');
    expect(await folder.sync()).toMatchObject({ kind: 'off', reason: 'no-upstream' });
    expect(await git(plain, 'status', '--porcelain')).toBe('?? Note.md\n');
  });

  it('syncs notes named like options, and unicode names with spaces, as files', async () => {
    const here = await clone('Studio', 'here');
    const there = await clone('Laptop', 'there');
    const names = ['--force.md', '-x.md', 'Café notes/Résumé ✓ plan.md'];
    for (const name of names) await here.write(name, `${name}\n`);
    expect(await here.sync()).toMatchObject({ kind: 'synced', pushed: true });
    expect(await there.sync()).toMatchObject({ kind: 'synced', pulled: true });
    for (const name of names) expect(await there.read(name)).toBe(`${name}\n`);
    expect(await readFile(join(there.dir, '--force.md'), 'utf8')).toBe('--force.md\n');
  });

  it('stops, touching nothing, while a merge started in a terminal waits to be finished', async () => {
    const here = await clone('Studio', 'here');
    const there = await clone('Laptop', 'there');
    await there.write(MARA, 'Edited on the laptop.\n');
    await there.sync();
    await writeFile(join(here.dir, MARA), 'Edited in the studio.\n');
    await git(here.dir, 'commit', '--quiet', '-am', 'By hand');
    const pull = await runGit(here.dir, ['pull', '--quiet', '--no-rebase'], env);
    expect(pull.code).not.toBe(0);
    await writeFile(join(here.dir, MARA), 'Merged by hand, half done.\n');
    expect(await here.sync()).toMatchObject({ kind: 'blocked', reason: 'merge-in-progress' });
    expect(await readFile(join(here.dir, MARA), 'utf8')).toBe('Merged by hand, half done.\n');
    expect(await onRemote(MARA)).toBe('Edited on the laptop.\n');
  });

  it('keeps text written into a conflicted note while its own merge settles', async () => {
    const here = await clone('Studio', 'here');
    const there = await clone('Laptop', 'there');
    await there.write(MARA, 'Edited on the laptop.\n');
    await there.sync();
    await here.write(MARA, 'Edited in the studio.\n');
    // Typed after git stopped on the conflict, while the sync reads both sides.
    const typing = actingAfter(here, 'showSide', () =>
      writeFile(join(here.dir, MARA), 'Typed into the markers by Claude.\n'),
    );
    const result = await here.sync(typing);
    expect(result).toMatchObject({ kind: 'synced', pushed: true });
    expect(await here.read(MARA)).toBe('Edited in the studio.\n');
    expect(await here.read('People/Mara Quill (conflict from Laptop).md')).toBe(
      'Edited on the laptop.\n',
    );
    expect(await here.read('People/Mara Quill (conflict from Studio).md')).toBe(
      'Typed into the markers by Claude.\n',
    );
  });

  it('asks before it syncs the deletion of many notes, and syncs it once approved', async () => {
    const here = await clone('Studio', 'here');
    for (let at = 1; at <= 30; at += 1) await here.write(`Bulk/Note ${at}.md`, `Note ${at}.\n`);
    await here.sync();
    for (let at = 1; at <= 25; at += 1) await rm(join(here.dir, 'Bulk', `Note ${at}.md`));
    const asked = await here.sync();
    expect(asked).toMatchObject({ kind: 'needs-confirmation' });
    if (asked.kind !== 'needs-confirmation') return;
    expect(asked.deletions).toHaveLength(25);
    expect(asked.message).toMatch(/^25 notes are missing/);
    expect(await onRemote('Bulk/Note 1.md')).toBe('Note 1.\n');
    here.approvals.approve(asked.deletions);
    expect(await here.sync()).toMatchObject({ kind: 'synced', pushed: true });
    expect(await onRemote('Bulk/Note 1.md')).toBeNull();
    expect(await onRemote('Bulk/Note 30.md')).toBe('Note 30.\n');
  });

  it('stops when iCloud has moved notes off this Mac, rather than delete them', async () => {
    const here = await clone('Studio', 'here');
    await rm(join(here.dir, MARA));
    await writeFile(join(here.dir, 'People', '.Mara Quill.md.icloud'), 'stand-in');
    expect(await here.sync()).toMatchObject({ kind: 'blocked', reason: 'icloud-evicted' });
    expect(await onRemote(MARA)).toBe('Leads payroll.\n');
  });

  it('sends a rename that changes only the case to the other Macs', async () => {
    const here = await clone('Studio', 'here');
    expect(await renameNote(here.deps, { from: 'Welcome.md', to: 'welcome.md' })).toMatchObject({
      kind: 'renamed',
    });
    expect(await here.sync()).toMatchObject({ kind: 'synced', pushed: true });
    const paths = await remotePaths();
    expect(paths).toContain('welcome.md');
    expect(paths).not.toContain('Welcome.md');
  });

  it('keeps both sides of a file that is not text, byte for byte', async () => {
    const here = await clone('Studio', 'here');
    const there = await clone('Laptop', 'there');
    const plan = 'Images/plan.png';
    await mkdir(join(here.dir, 'Images'));
    await writeFile(join(here.dir, plan), Buffer.from([0x89, 0xff, 0x00, 1]));
    await here.sync();
    await there.sync();
    await writeFile(join(there.dir, plan), Buffer.from([0x89, 0xff, 0x00, 2]));
    await there.sync();
    await writeFile(join(here.dir, plan), Buffer.from([0x89, 0xff, 0x00, 3]));
    const copy = 'Images/plan (conflict from Laptop).png';
    expect(await here.sync()).toMatchObject({ kind: 'synced', conflicts: [{ path: plan, copy }] });
    expect([...(await readFile(join(here.dir, plan)))]).toEqual([0x89, 0xff, 0x00, 3]);
    expect([...(await readFile(join(here.dir, copy)))]).toEqual([0x89, 0xff, 0x00, 2]);
  });

  it('keeps secrets, Finder files, nested repositories and huge files out, and says so', async () => {
    const here = await clone('Studio', 'here');
    await writeFile(join(here.dir, '.gitignore'), 'drafts/\n');
    await writeFile(join(here.dir, '.env'), 'TOKEN=example\n');
    await writeFile(join(here.dir, '.DS_Store'), 'finder');
    await mkdir(join(here.dir, 'Code', 'tool'), { recursive: true });
    await git(join(here.dir, 'Code', 'tool'), 'init', '--quiet');
    await writeFile(join(here.dir, 'Code', 'tool', 'x.md'), 'Inside another repository.\n');
    await writeFile(join(here.dir, 'video.mov'), '');
    await truncate(join(here.dir, 'video.mov'), 101 * 1024 * 1024);
    const result = await here.sync();
    expect(result).toMatchObject({ kind: 'synced', pushed: true });
    if (result.kind !== 'synced') return;
    expect(result.warnings.join(' ')).toMatch(/video\.mov is over GitHub’s 100 MB limit/);
    expect(result.warnings.join(' ')).toMatch(/Code\/tool is a git repository of its own/);
    const paths = await remotePaths();
    for (const left of ['.env', '.DS_Store', 'video.mov', 'Code/tool', 'Code/tool/x.md']) {
      expect(paths).not.toContain(left);
    }
    const ignore = (await onRemote('.gitignore')) ?? '';
    expect(ignore.startsWith('drafts/\n')).toBe(true);
    expect(ignore).toContain('# <<< DFAI Lite');
  });

  it('leaves a file in _index/ the app never writes, and says so', async () => {
    const here = await clone('Studio', 'here');
    await here.sync();
    await mkdir(join(here.dir, '_index'), { recursive: true });
    await writeFile(join(here.dir, '_index', 'by-claude.md'), 'A page Claude added.\n');
    await applyExternalChanges(here.deps, ['_index/by-claude.md']);
    const result = await here.sync();
    expect(result).toMatchObject({ kind: 'synced' });
    if (result.kind !== 'synced') return;
    expect(result.warnings.join(' ')).toMatch(/_index\/by-claude\.md is not a file the app writes/);
    expect(await here.read('_index/by-claude.md')).toBe('A page Claude added.\n');
  });
});
