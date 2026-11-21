import {
  conflictCopyPath,
  conflictStep,
  editConflictCopyPath,
  gitFailureKind,
  isConflictCopyPath,
  isoDate,
  macLabel,
  macOfCommit,
  parseGitStatus,
  pushDueIn,
  syncCommitMessage,
} from './index.ts';

describe('conflict copies', () => {
  const path = 'Projects/Larkspur Payroll.md';

  it('names the other Mac’s copy beside the note, numbered when taken', () => {
    expect(conflictCopyPath({ path, mac: 'Mara’s MacBook', taken: [] })).toBe(
      'Projects/Larkspur Payroll (conflict from Mara’s MacBook).md',
    );
    expect(
      conflictCopyPath({
        path,
        mac: 'Studio',
        taken: ['projects/larkspur payroll (conflict from studio).md'],
      }),
    ).toBe('Projects/Larkspur Payroll (conflict from Studio) 2.md');
  });

  it('keeps a Mac’s name safe in a file name', () => {
    expect(macLabel('a/b:c')).toBe('a-b-c');
    expect(macLabel('  ')).toBe('another Mac');
    expect(macLabel('x'.repeat(60))).toHaveLength(40);
  });

  it('names an edit that lost a race by the date', () => {
    expect(editConflictCopyPath({ path, date: '2026-11-21', taken: [] })).toBe(
      'Projects/Larkspur Payroll (conflict 2026-11-21).md',
    );
  });

  it('recognises both kinds of copy', () => {
    expect(isConflictCopyPath('Idea (conflict 2026-11-21) 2.md')).toBe(true);
    expect(isConflictCopyPath('Idea (conflict from Tobias’s Mac (2)).md')).toBe(true);
    expect(isConflictCopyPath('Idea (conflict).md')).toBe(false);
    expect(isConflictCopyPath('Idea (conflict from )/x.md')).toBe(false);
  });

  it('formats the local calendar date', () => {
    expect(isoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('git status', () => {
  const entry = (kind: string, path: string) =>
    kind === 'u'
      ? `u UU N... 100644 100644 100644 100644 a b c ${path}`
      : kind === '?'
        ? `? ${path}`
        : `1 .M N... 100644 100644 100644 a b ${path}`;

  it('reads the branch, its upstream, and how far apart they are', () => {
    const status = parseGitStatus(
      [
        '# branch.oid 1234',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -1',
        '',
      ].join('\0'),
    );
    expect(status).toMatchObject({
      branch: 'main',
      born: true,
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
    });
  });

  it('says when there is no upstream, or it is not on the remote yet', () => {
    const none = parseGitStatus('# branch.oid (initial)\0# branch.head main\0');
    expect(none).toMatchObject({ born: false, upstream: null, ahead: null });
    const unpushed = parseGitStatus('# branch.oid (initial)\0# branch.upstream origin/main\0');
    expect(unpushed).toMatchObject({ upstream: 'origin/main', ahead: null, behind: null });
  });

  it('lists changed and conflicted paths, spaces and dashes kept', () => {
    const status = parseGitStatus(
      [
        entry('1', 'People/Mara Quill.md'),
        entry('?', '--force.md'),
        '2 R. N... 100644 100644 100644 a b R100 New name.md',
        'Old name.md',
        entry('u', 'Projects/Larkspur Payroll.md'),
        '',
      ].join('\0'),
    );
    expect(status.changed).toEqual([
      '--force.md',
      'New name.md',
      'Old name.md',
      'People/Mara Quill.md',
    ]);
    expect(status.conflicts).toEqual([{ path: 'Projects/Larkspur Payroll.md', code: 'UU' }]);
  });
});

describe('sync rules', () => {
  it('names a commit for the note, the count, or the index, and the Mac', () => {
    const mac = 'Studio';
    expect(syncCommitMessage({ changed: ['People/Mara Quill.md'], mac })).toBe(
      'Notes: Mara Quill\n\nFrom: Studio',
    );
    expect(syncCommitMessage({ changed: ['a.md', 'b.md', '_index/README.md'], mac })).toMatch(
      /^Notes: 2 changed\n/,
    );
    expect(syncCommitMessage({ changed: ['_index/README.md'], mac })).toMatch(/^Notes: index\n/);
  });

  it('reads the Mac back from a commit, or null for one the app did not make', () => {
    expect(macOfCommit('Notes: merge\n\nFrom: Tobias’s Mac\n')).toBe('Tobias’s Mac');
    expect(macOfCommit('Meeting: 2026-11-21 Weekly sync\n')).toBeNull();
  });

  it('never lets a delete beat an edit', () => {
    expect(conflictStep({ path: 'a.md', code: 'UU' })).toBe('keep-both');
    expect(conflictStep({ path: 'a.md', code: 'AA' })).toBe('keep-both');
    expect(conflictStep({ path: 'a.md', code: 'UD' })).toBe('keep-file');
    expect(conflictStep({ path: 'a.md', code: 'DU' })).toBe('keep-file');
    expect(conflictStep({ path: 'a.md', code: 'DD' })).toBe('drop');
    expect(conflictStep({ path: '_index/README.md', code: 'UU' })).toBe('regenerate');
  });

  it.each([
    [null, '', 'unreachable'],
    [128, 'fatal: Authentication failed for https://example.com/notes.git', 'auth'],
    [128, 'git@example.com: Permission denied (publickey).\nfatal: Could not read', 'auth'],
    [128, "fatal: '/tmp/gone.git' does not appear to be a git repository", 'unreachable'],
    [128, 'fatal: unable to access: Could not resolve host: example.com', 'unreachable'],
    [1, ' ! [rejected]        main -> main (fetch first)', 'rejected'],
    [1, 'fatal: something else', 'error'],
  ] as const)('a failure with code %s and %j is %s', (code, stderr, kind) => {
    expect(gitFailureKind({ code, stderr })).toBe(kind);
  });
});

describe('the sync schedule', () => {
  it('pushes the usual delay after a change, sooner once changes have waited long', () => {
    expect(pushDueIn({ now: 1_000, firstUnsyncedAt: null })).toBe(30_000);
    expect(pushDueIn({ now: 200_000, firstUnsyncedAt: 0 })).toBe(30_000);
    expect(pushDueIn({ now: 290_000, firstUnsyncedAt: 0 })).toBe(10_000);
    expect(pushDueIn({ now: 400_000, firstUnsyncedAt: 0 })).toBe(0);
    expect(pushDueIn({ now: 0, firstUnsyncedAt: 50_000 })).toBe(30_000);
  });
});
