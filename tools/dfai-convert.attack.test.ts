// Attacks on one note's conversion: whatever a DFAI note carried must reach
// the Lite note, or be named in `dropped` so the report shows it.
import { convertNote } from './dfai-convert.ts';

const convert = (text: string, path = 'Projects/Larkspur rollout.md') =>
  convertNote({ path, text });

describe('convertNote under attack', () => {
  it('keeps every line of a `|` block scalar (the yaml library writes multi-line strings so)', () => {
    const note = convert(
      '---\ntype: project\nsummary: |-\n  Move the Larkspur Payroll ledger.\n  Mara Quill signs off.\n---\nThe rollout.\n',
    );
    expect(note.text).toContain('Move the Larkspur Payroll ledger.');
    expect(note.text).toContain('Mara Quill signs off.');
  });

  it('keeps the text of a `>` folded scalar', () => {
    const note = convert(
      '---\ntype: project\ngoal: >\n  Ship the cache\n  behind a flag.\n---\nThe rollout.\n',
    );
    expect(note.text).toContain('Ship the cache');
  });

  it('never silently drops a property whose key has a space (Obsidian-style keys)', () => {
    const note = convert('---\ntype: project\nDue date: 2026-12-01\n---\nThe rollout.\n');
    const kept = note.text.includes('2026-12-01');
    const reported = note.dropped.includes('Due date');
    expect(kept || reported).toBe(true);
  });

  it('never silently drops a comment line in the frontmatter', () => {
    const note = convert(
      '---\ntype: project\n# Tobias Fenn owns the budget sign-off\nstatus: active\n---\nThe rollout.\n',
    );
    expect(note.text).toContain('Tobias Fenn owns the budget sign-off');
  });

  it('keeps the first section of a note that opens with a `---` rule (not frontmatter)', () => {
    const text =
      '---\nMara Quill asked for the payroll cutover plan by Friday.\n---\n\nLater notes.\n';
    const note = convert(text);
    expect(note.text).toContain('Mara Quill asked for the payroll cutover plan by Friday.');
  });

  it('reads frontmatter after a UTF-8 byte-order mark, so a person still moves to People/', () => {
    const note = convert(
      '﻿---\ntype: person\nemail: mara.quill@example.com\n---\nLeads payroll.\n',
      'Contacts/Mara Quill.md',
    );
    expect(note.path).toBe('People/Mara Quill.md');
    expect(note.text).not.toContain('type: person');
  });

  it('keeps the body of a CRLF note and leaves no frontmatter behind', () => {
    const note = convert(
      '---\r\ntype: person\r\nemail: mara.quill@example.com\r\n---\r\nLeads payroll at Larkspur Payroll.\r\n',
      'Contacts/Mara Quill.md',
    );
    expect(note.path).toBe('People/Mara Quill.md');
    expect(note.text).toContain('Leads payroll at Larkspur Payroll.');
    expect(note.text).toContain('mara.quill@example.com');
    expect(note.text).not.toContain('type: person');
  });

  it('keeps an attendee whose quoted name holds a comma as one person', () => {
    const note = convert(
      `---\ntype: meeting\ndate: '2026-09-29'\ntitle: Sync\nattendees: ["Fenn, Tobias", Mara Quill]\n---\nNotes.\n`,
    );
    expect(note.text).toContain('[[Fenn, Tobias]]');
  });

  it('keeps every body line of a meeting, a fenced `---` and all', () => {
    const body = '## Notes\n\n```yaml\n---\nkey: value\n---\n```\n\nDone. ^t0001\n';
    const note = convert(`---\ntype: meeting\ndate: '2026-09-29'\ntitle: Sync\n---\n${body}`);
    expect(note.path).toBe('Meetings/2026/09/2026-09-29 Sync.md');
    expect(note.text.endsWith(body)).toBe(true);
  });
});
