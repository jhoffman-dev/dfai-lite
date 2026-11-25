import { buildAiIndex } from '../ai-index/index.ts';
import {
  MeetingInputError,
  meetingCommitMessage,
  meetingNote,
  meetingPath,
  parseMeetingInput,
  type MeetingInput,
} from './index.ts';

const sync: MeetingInput = {
  title: 'Larkspur rollout sync',
  date: '2026-11-21',
  start: '10:00',
  end: '10:30',
  attendees: [
    { name: 'Mara Quill', email: 'mara.quill@example.com' },
    { name: 'Tobias Fenn', email: 'tobias.fenn@example.com' },
  ],
  about: ['Larkspur rollout'],
  summary:
    'Mara and Tobias agreed to ship the ledger move behind a flag. Tobias raised the cut-over.',
  decisions: ['Ship behind a flag.'],
  nextSteps: ['[[Mara Quill]] sends the revised plan by Friday.'],
  transcript: [
    { speaker: 'Mara Quill', time: '00:00:05', text: 'Shall we start with the flag?' },
    { speaker: 'Tobias Fenn', time: '00:00:09', text: 'Yes.\nIt is ready.' },
  ],
};

describe('meetingNote', () => {
  it('writes the contract shape: sentence, header lines with the transcript link, sections', () => {
    const note = meetingNote(sync);
    expect(note.path).toBe('Meetings/2026/11/2026-11-21 Larkspur rollout sync.md');
    expect(note.text).toBe(
      [
        'Mara and Tobias agreed to ship the ledger move behind a flag. #meeting',
        '',
        '- When: 2026-11-21 10:00–10:30',
        '- With: [[Mara Quill]], [[Tobias Fenn]]',
        '- About: [[Larkspur rollout]]',
        '- Transcript: [[2026-11-21 Larkspur rollout sync (transcript)]]',
        '',
        '## Summary',
        '',
        'Mara and Tobias agreed to ship the ledger move behind a flag. Tobias raised the cut-over.',
        '',
        '## Decisions',
        '',
        '- Ship behind a flag.',
        '',
        '## Next steps',
        '',
        '- [[Mara Quill]] sends the revised plan by Friday.',
        '',
      ].join('\n'),
    );
  });

  it('names the transcript link from the path the note is written at', () => {
    const at = 'Meetings/2026/11/2026-11-21 Larkspur rollout sync (granola 0a1b2c3d).md';
    expect(meetingNote(sync, at).text).toContain(
      '- Transcript: [[2026-11-21 Larkspur rollout sync (granola 0a1b2c3d) (transcript)]]',
    );
  });

  it('leaves out empty sections and falls back to "Meeting on <date> with …"', () => {
    const { text } = meetingNote({
      title: 'Catch-up',
      date: '2026-11-21',
      attendees: [{ name: 'Mara Quill' }, { name: '', email: 'tobias.fenn@example.com' }],
      decisions: ['  '],
    });
    expect(text).toBe(
      'Meeting on 2026-11-21 with Mara Quill and tobias.fenn. #meeting\n\n- When: 2026-11-21\n- With: [[Mara Quill]], [[tobias.fenn]]\n',
    );
  });

  it('never invents a person: no name and no address is no link', () => {
    const { text } = meetingNote({
      title: 'Solo',
      date: '2026-11-21',
      attendees: [{ name: ' ' }, { name: '', email: 'not an address' }],
    });
    expect(text).toBe('Meeting on 2026-11-21. #meeting\n\n- When: 2026-11-21\n');
  });

  it('links each person once, names cleaned of what a file name may not hold', () => {
    const { text } = meetingNote({
      title: 'x',
      date: '2026-11-21',
      attendees: [{ name: 'Mara Quill' }, { name: 'Mara  Quill' }, { name: 'Tobias [Fenn]' }],
    });
    expect(text).toContain('- With: [[Mara Quill]], [[Tobias Fenn]]\n');
  });

  it('ends the opening sentence with a full stop when the summary has none', () => {
    const { text } = meetingNote({ ...sync, summary: '- Cut-over moves to May' });
    expect(text.split('\n')[0]).toBe('Cut-over moves to May. #meeting');
  });

  it('writes a source link only when it is a web address', () => {
    expect(meetingNote({ ...sync, sourceUrl: 'https://docs.example.com/d/1' }).text).toContain(
      '- About: [[Larkspur rollout]]\n- Source: https://docs.example.com/d/1\n',
    );
    expect(meetingNote({ ...sync, sourceUrl: 'javascript:alert(1)' }).text).not.toContain('Source');
  });

  it('is deterministic and ends in exactly one newline', () => {
    const first = meetingNote(sync).text;
    expect(meetingNote(structuredClone(sync)).text).toBe(first);
    expect(first.endsWith('.\n')).toBe(true);
  });
});

describe('meetingPath and meetingCommitMessage', () => {
  it('cleans the title of forbidden characters and puts it in the month folder', () => {
    const input = { title: 'Q4: plan / "budget" #1?', date: '2026-01-05' };
    expect(meetingPath(input)).toBe('Meetings/2026/01/2026-01-05 Q4 plan budget 1.md');
    expect(meetingCommitMessage(input)).toBe('Meeting: 2026-01-05 Q4 plan budget 1');
  });

  it('names a meeting with no usable title "Meeting"', () => {
    expect(meetingPath({ title: ' ://', date: '2026-01-05' })).toBe(
      'Meetings/2026/01/2026-01-05 Meeting.md',
    );
  });

  it('refuses a date that is not YYYY-MM-DD', () => {
    expect(() => meetingPath({ title: 'x', date: '2026-13-01' })).toThrow(MeetingInputError);
    expect(() => meetingPath({ title: 'x', date: '21/11/2026' })).toThrow(/YYYY-MM-DD/);
  });
});

describe('parseMeetingInput', () => {
  it('reads JSON into an input, optional fields left absent', () => {
    expect(
      parseMeetingInput({ title: 't', date: '2026-11-21', attendees: [{ name: 'Mara Quill' }] }),
    ).toEqual({
      title: 't',
      date: '2026-11-21',
      attendees: [{ name: 'Mara Quill' }],
      about: [],
      decisions: [],
      nextSteps: [],
      transcript: [],
    });
  });

  it('refuses a missing title, a wrong type, and a turn without text, by field', () => {
    expect(() => parseMeetingInput({ date: '2026-11-21' })).toThrow('title: missing');
    expect(() => parseMeetingInput({ title: 't', date: '2026-11-21', decisions: 'x' })).toThrow(
      'decisions: expected a list',
    );
    expect(() =>
      parseMeetingInput({ title: 't', date: 'd', transcript: [{ speaker: 'Mara' }] }),
    ).toThrow('transcript[0].text: missing');
    expect(() => parseMeetingInput([])).toThrow('input: expected an object');
  });
});

describe('a generated note in the AI index', () => {
  it('is listed in its month with its date, title, people, about and first sentence', () => {
    const note = meetingNote(sync);
    const month = buildAiIndex([note]).find(({ path }) => path === '_index/meetings/2026-11.md');
    expect(month?.text).toContain(
      '2026-11-21 | Larkspur rollout sync | with [[Mara Quill]] [[Tobias Fenn]] | about [[Larkspur rollout]] | Mara and Tobias agreed to ship the ledger move behind a flag.\n',
    );
  });
});
