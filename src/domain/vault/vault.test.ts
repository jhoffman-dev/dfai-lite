import {
  buildFolderTree,
  cleanNoteName,
  folderNameProblem,
  foldersAbove,
  isDisposableFile,
  isVisibleFolder,
  pathMovedInto,
  flattenFolderTree,
  folderOf,
  isHiddenPath,
  isTextFile,
  isVaultContent,
  isVisibleNote,
  noteNameProblem,
  noteTitle,
  pathAfterMove,
  uniqueNotePath,
} from './index.ts';

describe('paths', () => {
  it('takes the title from the file name and the folder from the rest', () => {
    expect(noteTitle('Meetings/2026/11/2026-11-21 Weekly sync.md')).toBe('2026-11-21 Weekly sync');
    expect(folderOf('Inbox/Idea.md')).toBe('Inbox');
    expect(folderOf('Idea.md')).toBe('');
  });

  it('follows a note or a folder through a move', () => {
    expect(pathAfterMove('People/Mara.md', { from: 'People/Mara.md', to: 'Mara.md' })).toBe(
      'Mara.md',
    );
    expect(pathAfterMove('People/Mara.md', { from: 'People', to: 'Contacts' })).toBe(
      'Contacts/Mara.md',
    );
    expect(pathAfterMove('Peoples/Mara.md', { from: 'People', to: 'Contacts' })).toBeNull();
  });
});

describe('file names', () => {
  it('turns forbidden characters into spaces and trims dots', () => {
    expect(cleanNoteName('Q3: plan / #draft [x]')).toBe('Q3 plan draft x');
    expect(cleanNoteName('..hidden.')).toBe('hidden');
    expect(cleanNoteName('***')).toBe('');
  });

  it('says why a typed name cannot be used', () => {
    expect(noteNameProblem('Larkspur Payroll')).toBeNull();
    expect(noteNameProblem(' ')).toMatch(/name/);
    expect(noteNameProblem('a|b')).toMatch(/\|/);
    expect(noteNameProblem('.env')).toMatch(/dot/);
  });
});

describe('a new note’s path', () => {
  it('numbers Untitled past the names taken, case aside', () => {
    expect(uniqueNotePath({ folder: 'Inbox', taken: [] })).toBe('Inbox/Untitled.md');
    expect(
      uniqueNotePath({ folder: 'Inbox', taken: ['Inbox/untitled.md', 'Inbox/Untitled 2.md'] }),
    ).toBe('Inbox/Untitled 3.md');
  });

  it('cleans a typed name and falls back to Untitled', () => {
    expect(uniqueNotePath({ folder: '', name: 'Plan: Q3', taken: [] })).toBe('Plan Q3.md');
    expect(uniqueNotePath({ folder: '', name: '///', taken: [] })).toBe('Untitled.md');
  });
});

describe('what is hidden', () => {
  it('hides the index, the app folder and dotfiles, and anything not markdown', () => {
    expect(isHiddenPath('_index/README.md')).toBe(true);
    expect(isHiddenPath('.dfai-lite/favorites.json')).toBe(true);
    expect(isHiddenPath('Projects/.draft.md')).toBe(true);
    expect(isHiddenPath('Projects/_index.md')).toBe(false);
    expect(isVisibleNote('Resources/diagram.png')).toBe(false);
    expect(isVisibleNote('Inbox/Idea.md')).toBe(true);
  });
});

describe('what the app reads from the folder', () => {
  it('reads notes and its own JSON as text, anywhere but other dot folders', () => {
    expect(isTextFile('People/Mara Quill.md')).toBe(true);
    expect(isTextFile('_index/README.md')).toBe(true);
    expect(isTextFile('.dfai-lite/favorites.json')).toBe(true);
    expect(isTextFile('Images/plan.png')).toBe(false);
    expect(isTextFile('.obsidian/workspace.md')).toBe(false);
    expect(isTextFile('People')).toBe(false);
  });

  it('leaves git, editors’ dot files and packages out of the vault', () => {
    expect(isVaultContent('Images/plan.png')).toBe(true);
    expect(isVaultContent('.git/index')).toBe(false);
    expect(isVaultContent('Inbox/.DS_Store')).toBe(false);
    expect(isVaultContent('tools/node_modules/x.md')).toBe(false);
  });
});

describe('the folder tree', () => {
  const tree = buildFolderTree([
    'Projects/Note 10.md',
    'Projects/note 2.md',
    'Inbox/Idea.md',
    'Projects/Larkspur/Plan.md',
    'Root.md',
    '_index/README.md',
    '.dfai-lite/favorites.json',
  ]);

  it('builds folders from paths, sorted as Finder sorts, hidden paths left out', () => {
    expect(tree.folders.map((folder) => folder.name)).toEqual(['Inbox', 'Projects']);
    const projects = tree.folders[1];
    expect(projects?.notes).toEqual(['Projects/note 2.md', 'Projects/Note 10.md']);
    expect(projects?.noteCount).toBe(3);
    expect(tree.noteCount).toBe(5);
  });

  it('flattens only expanded folders, folders before notes', () => {
    const rows = flattenFolderTree(tree, new Set(['Projects']));
    expect(rows.map((row) => `${row.depth}:${row.name}`)).toEqual([
      '0:Inbox',
      '0:Projects',
      '1:Larkspur',
      '1:note 2',
      '1:Note 10',
      '0:Root',
    ]);
  });
});

describe('folders', () => {
  it('shows an empty folder the disk lists, but never a hidden one', () => {
    const tree = buildFolderTree(
      ['Inbox/Idea.md'],
      ['Inbox', 'Areas', 'Areas/Garden', '_index', '.dfai-lite', 'Areas/.obsidian'],
    );
    expect(tree.folders.map((folder) => folder.path)).toEqual(['Areas', 'Inbox']);
    expect(tree.folders[0]?.folders.map((folder) => folder.path)).toEqual(['Areas/Garden']);
    expect(tree.folders[0]?.noteCount).toBe(0);
    expect(isVisibleFolder('')).toBe(false);
  });

  it('names the folders above a path, nearest first', () => {
    expect(foldersAbove('A/B/x.md')).toEqual(['A/B', 'A']);
    expect(foldersAbove('x.md')).toEqual([]);
  });

  it('counts a keep file and .DS_Store as nothing in a folder', () => {
    expect(isDisposableFile('Areas/.gitkeep')).toBe(true);
    expect(isDisposableFile('Areas/.DS_Store')).toBe(true);
    expect(isDisposableFile('Areas/plan.png')).toBe(false);
  });

  it('says why a typed folder name cannot be used, in a folder’s words', () => {
    expect(folderNameProblem('Areas')).toBeNull();
    expect(folderNameProblem('')).toMatch(/folder/);
    expect(folderNameProblem('a/b')).toMatch(/folder’s name cannot hold \//);
    expect(folderNameProblem('.git')).toMatch(/dot/);
  });
});

describe('moving into a folder', () => {
  it('keeps the name and lands under the folder, the root included', () => {
    expect(pathMovedInto({ kind: 'note', path: 'Inbox/Idea.md' }, 'Projects')).toBe(
      'Projects/Idea.md',
    );
    expect(pathMovedInto({ kind: 'note', path: 'Inbox/Idea.md' }, '')).toBe('Idea.md');
    expect(pathMovedInto({ kind: 'folder', path: 'People' }, 'Areas')).toBe('Areas/People');
  });

  it('is nothing when already there, and refused into itself or under itself', () => {
    expect(pathMovedInto({ kind: 'note', path: 'Inbox/Idea.md' }, 'Inbox')).toBeNull();
    expect(pathMovedInto({ kind: 'folder', path: 'People' }, 'People')).toBeNull();
    expect(pathMovedInto({ kind: 'folder', path: 'People' }, 'People/Team')).toBeNull();
    expect(pathMovedInto({ kind: 'folder', path: 'People' }, 'Peoples')).toBe('Peoples/People');
  });
});
