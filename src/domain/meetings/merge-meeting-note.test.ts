import { meetingNote, mergeMeetingNote, type MeetingInput } from './index.ts';

const base: MeetingInput = {
  title: 'Larkspur rollout sync',
  date: '2026-11-21',
  attendees: [{ name: 'Mara Quill' }, { name: 'Tobias Fenn' }],
  summary: 'They agreed to ship behind a flag.',
  nextSteps: ['[[Tobias Fenn]] flags the ledger move.'],
};
const transcript = [{ speaker: 'Mara Quill', time: '00:00:05', text: 'Shall we start?' }];

describe('mergeMeetingNote', () => {
  it('adds a transcript that arrives after the summary, at the end', () => {
    const first = meetingNote(base).text;
    const merged = mergeMeetingNote(first, { ...base, transcript });
    expect(merged).toBe(`${first}\n## Transcript\n\n**Mara Quill** [00:00:05] Shall we start?\n`);
  });

  it('is the whole note when the merged input is the same: merging twice changes nothing', () => {
    const full = meetingNote({ ...base, transcript }).text;
    expect(mergeMeetingNote(full, { ...base, transcript })).toBe(full);
    const once = mergeMeetingNote(meetingNote(base).text, { ...base, transcript });
    expect(mergeMeetingNote(once, { ...base, transcript })).toBe(once);
  });

  it('never rewrites a section a person edited, nor the header', () => {
    const edited = meetingNote(base)
      .text.replace('They agreed', 'Mara and Tobias agreed (edited)')
      .replace('- With: [[Mara Quill]], [[Tobias Fenn]]', '- With: [[Mara Quill]]');
    const merged = mergeMeetingNote(edited, {
      ...base,
      attendees: [...base.attendees, { name: 'Ada Example' }],
      summary: 'A different summary.',
      nextSteps: ['Something new.'],
      transcript,
    });
    expect(merged.startsWith(edited)).toBe(true);
    expect(merged).not.toContain('A different summary');
    expect(merged).not.toContain('Something new');
    expect(merged).not.toContain('Ada Example');
  });

  it('puts a new section in contract order, before a later one the note has', () => {
    const note = 'Sync. #meeting\n\n## Summary\n\nShort.\n\n## Transcript\n\n**Mara Quill** Hi.\n';
    const merged = mergeMeetingNote(note, { ...base, decisions: ['Ship it.'], nextSteps: [] });
    expect(merged).toBe(
      'Sync. #meeting\n\n## Summary\n\nShort.\n\n## Decisions\n\n- Ship it.\n\n## Transcript\n\n**Mara Quill** Hi.\n',
    );
  });

  it('reads headings in any case and ignores ones inside code', () => {
    const tail = '## next steps\n\n- mine\n\n```\n## Summary\n```\n';
    const merged = mergeMeetingNote(`Sync.\n\n${tail}`, base);
    expect(merged).toBe(`Sync.\n\n## Summary\n\nThey agreed to ship behind a flag.\n\n${tail}`);
  });

  it('appends to a note a person wrote with no sections, ending it in a newline', () => {
    expect(mergeMeetingNote('Notes from the call', { ...base, nextSteps: [] })).toBe(
      'Notes from the call\n\n## Summary\n\nThey agreed to ship behind a flag.\n',
    );
  });

  it('keeps a CRLF note’s lines and does not duplicate its sections', () => {
    const note = 'Sync.\r\n\r\n## Summary\r\n\r\nShort.\r\n';
    expect(mergeMeetingNote(note, { ...base, nextSteps: [] })).toBe(note);
  });

  it('writes the whole note into an empty file', () => {
    expect(mergeMeetingNote(' \n', base)).toBe(meetingNote(base).text);
  });
});
