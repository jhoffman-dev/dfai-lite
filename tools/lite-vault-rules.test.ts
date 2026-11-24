import {
  layoutMoves,
  leftOutReason,
  mergedPersonNote,
  propertiesToRemove,
  tidyFrontmatter,
  withoutDfaiMarkers,
} from './lite-vault-rules.ts';
import { readFrontmatter } from './frontmatter.ts';

describe('leftOutReason', () => {
  it.each([
    ['Tasks/2026/11/Ship it.md', undefined, 'task folder'],
    ['Archive/Tasks/Old.md', undefined, 'task folder'],
    ['Inbox/Proposals/Review what x left for you.md', undefined, 'automation proposals'],
    ['Archive/Inbox/Proposals/Claude.md', undefined, 'archived automation proposals'],
    ['Sync conflicts/atlas/types', undefined, "DFAI's sync conflicts"],
    ['.atlas/automations/log/After a meeting.md', undefined, 'DFAI automations and settings'],
    ['.atlas/settings.md', undefined, 'DFAI automations and settings'],
    ['.atlas/templates/Task.md', undefined, 'template for a left-out note type'],
    ['Notes/Somewhere/.DS_Store', undefined, 'Finder state'],
    ['.gitignore', undefined, 'written fresh by the new vault'],
    ['Inbox/Call the bank.md', 'task', 'task note'],
    ['Projects/Plan.md', 'proposal', 'automation proposal'],
  ])('leaves out %s', (path, type, reason) => {
    expect(leftOutReason(path, type)).toBe(reason);
  });

  it.each([
    ['Meetings/2026/11/2026-11-24 Sync.md', 'meeting'],
    ['People/Mara Quill.md', 'person'],
    ['.atlas/templates/Person.md', undefined],
    ['attachments/chart.png', undefined],
    // Only the root folder is a task folder: a project's own Tasks folder is content.
    ['Projects/Tasks/Notes.md', 'notes'],
  ])('keeps %s', (path, type) => {
    expect(leftOutReason(path, type)).toBeNull();
  });

  it('does not treat a nested .atlas/templates folder as a template', () => {
    expect(leftOutReason('.atlas/templates/old/Person.md', undefined)).toBe(
      'DFAI automations and settings',
    );
  });
});

describe('propertiesToRemove', () => {
  const props = (yaml: string) => readFrontmatter(`---\n${yaml}\n---\n`).properties;

  it('removes bookkeeping and a Notion-only source, keeps the rest', () => {
    const remove = propertiesToRemove(
      props(
        'type: notes\nnotion_id: abc\npara: projects\nsource: notion\ntags: [a]\nproject: "[[X]]"',
      ),
    );
    expect([...remove].sort()).toEqual(['notion_id', 'para', 'source']);
  });

  it('keeps a source that links somewhere', () => {
    expect(
      propertiesToRemove(props('source: "[[2026-07-01 Release Roundup]]"')).has('source'),
    ).toBe(false);
  });

  it("removes a meeting's people only when every one is an attendee", () => {
    const meeting = (people: string) =>
      props(
        `type: meeting\nattendees:\n  - name: 'Mara Quill'\n  - name: 'Tobias Fenn'\npeople:\n${people}`,
      );
    expect(
      propertiesToRemove(meeting('  - "[[Mara Quill]]"\n  - "[[Tobias Fenn]]"')).has('people'),
    ).toBe(true);
    expect(
      propertiesToRemove(meeting('  - "[[Mara Quill]]"\n  - "[[Jo Park]]"')).has('people'),
    ).toBe(false);
  });

  it("never removes a non-meeting's people", () => {
    const remove = propertiesToRemove(
      props('type: notes\nattendees:\n  - name: A\npeople:\n  - "[[A]]"'),
    );
    expect(remove.has('people')).toBe(false);
  });
});

describe('tidyFrontmatter', () => {
  it('takes out a removed key with its whole list, leaving every other byte', () => {
    const text =
      "---\ntype: meeting\ntasks:\n  - '[[Tasks/2026/One]]'\n  - '[[Tasks/2026/Two]]'\ntitle: 'Sync'\n---\nBody stays.\n";
    const tidied = tidyFrontmatter(text);
    expect(tidied.text).toBe("---\ntype: meeting\ntitle: 'Sync'\n---\nBody stays.\n");
    expect(tidied.removed).toEqual(['tasks']);
  });

  it('takes out a list written at the same indent as its key', () => {
    const text = '---\ntype: notes\nproject_tasks:\n- a\n- b\ntags: [x]\n---\n';
    expect(tidyFrontmatter(text).text).toBe('---\ntype: notes\ntags: [x]\n---\n');
  });

  it('writes source_url as source when no source is left', () => {
    const text = "---\ntype: meeting\nsource: notion\nsource_url: 'https://x.test/d/1'\n---\n";
    expect(tidyFrontmatter(text).text).toBe(
      "---\ntype: meeting\nsource: 'https://x.test/d/1'\n---\n",
    );
  });

  it('keeps source_url when a source stays', () => {
    const text = "---\nsource: '[[Meeting]]'\nsource_url: 'https://x.test'\n---\n";
    expect(tidyFrontmatter(text)).toEqual({ text, removed: [] });
  });

  it('returns a note with nothing to remove, or no frontmatter, unchanged', () => {
    for (const text of [
      '---\ntype: person\nemail: a@b.test\n---\nHi\n',
      'Plain note.\n',
      '---\nunclosed\n',
    ]) {
      expect(tidyFrontmatter(text)).toEqual({ text, removed: [] });
    }
  });

  it('keeps Windows line endings', () => {
    const text = '---\r\ntype: notes\r\nnotion_id: x\r\ntags: [a]\r\n---\r\nBody\r\n';
    expect(tidyFrontmatter(text).text).toBe('---\r\ntype: notes\r\ntags: [a]\r\n---\r\nBody\r\n');
  });
});

describe('withoutDfaiMarkers', () => {
  it('removes each marker line and the blank line after it', () => {
    const text =
      '<!-- atlas:summary v1 -->\n\n> [!summary] S\n> Text.\n\n<!-- atlas:summary v1 -->\n\n## Notes\n';
    expect(withoutDfaiMarkers(text)).toEqual({
      text: '> [!summary] S\n> Text.\n\n## Notes\n',
      count: 2,
    });
  });

  it('leaves other comments and inline mentions alone', () => {
    const text = '<!-- keep me -->\nSee `<!-- atlas:x -->` inline.\n';
    expect(withoutDfaiMarkers(text)).toEqual({ text, count: 0 });
  });
});

describe('mergedPersonNote', () => {
  const full = {
    raw: '---\ntype: person\nemail: a@x.test\n---\nLong history here.\n',
    converted: 'Long history here.\n\n- Email: a@x.test\n',
  };
  const stub = {
    raw: '---\ntype: person\nemail: b@x.test\n---\n',
    converted: '- Email: b@x.test\n',
  };

  it('keeps the fuller note whole and adds the other under a heading', () => {
    const expected = `${full.raw}\n## Also recorded as\n\n- Email: b@x.test\n`;
    expect(mergedPersonNote(full, stub)).toBe(expected);
    expect(mergedPersonNote(stub, full)).toBe(expected);
  });

  it('adds nothing when the other note is empty', () => {
    expect(mergedPersonNote(full, { raw: '---\ntype: person\n---\n', converted: '' })).toBe(
      full.raw,
    );
  });
});

describe('layoutMoves', () => {
  it('moves only the DFAI folders that exist, then root notes by type', () => {
    const notes = [
      { path: 'Companies/HiBob.md', type: 'company' },
      { path: 'Terms/HiBob.md', type: 'term' },
      { path: 'Ship small.md', type: 'decision' },
      { path: 'Loose idea.md', type: 'notes' },
      { path: 'CLAUDE.md', type: undefined },
    ];
    expect(
      layoutMoves(
        notes,
        notes.map(({ path }) => path),
      ),
    ).toEqual([
      { from: 'Companies', to: 'Resources/Companies' },
      { from: 'Terms', to: 'Resources/Glossary' },
      { from: 'Ship small.md', to: 'Resources/Decisions/Ship small.md' },
      { from: 'Loose idea.md', to: 'Inbox/Loose idea.md' },
    ]);
  });
});
