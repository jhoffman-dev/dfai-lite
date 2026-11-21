import { MeetingInputError, fromGeminiNotes, meetingNote } from './index.ts';

const notes = [
  'Mara and Tobias agreed to move Larkspur Payroll onto the new ledger behind a flag.',
  '',
  '## Decisions',
  '',
  '- Ship the ledger move behind a flag.',
  '',
  '## Suggested next steps',
  '',
  '- [Tobias Fenn] Flag the ledger: put the move behind a flag',
  '  before Friday.',
  '- [ ] Book the cut-over room.',
  '',
  '## Details',
  '',
  '- Cut-over: the ledger is ready; Tobias wants a flag first.',
].join('\n');

const transcript = [
  '📖 Transcript',
  'Nov 20, 2026',
  'Larkspur sync - Transcript',
  '### 00:00:00',
  'Mara Quill: Morning. Shall we start with the ledger?',
  'Tobias Fenn: Yes. It is ready,',
  'but I would like a flag on it first.',
  'Note: the flag ships Friday.',
  '### 00:09:44',
  '**Room 4**: Fine by me.',
  '```',
  'Mara Quill: quoted, not a turn',
  '```',
  '### Transcription ended after 00:10:02',
].join('\n');

const email = {
  subject: 'Notes: “Larkspur sync” Nov 20, 2026 2:30 PM PST',
  attendees: [
    'Mara Quill — mara.quill@example.com',
    'tobias.fenn@example.com',
    'Tobias Fenn <tobias.fenn@example.com>',
    '- [platform-team@example.com](mailto:platform-team@example.com)',
  ],
  summaryMd: notes,
  transcriptMd: transcript,
  url: 'https://docs.example.com/d/abc',
};

describe('fromGeminiNotes', () => {
  it('maps a Gemini meeting to a note input', () => {
    expect(fromGeminiNotes(email)).toEqual({
      title: 'Larkspur sync',
      date: '2026-11-20',
      start: '14:30',
      attendees: [
        { name: 'Mara Quill', email: 'mara.quill@example.com' },
        { name: 'Tobias Fenn', email: 'tobias.fenn@example.com' },
      ],
      summary: 'Mara and Tobias agreed to move Larkspur Payroll onto the new ledger behind a flag.',
      decisions: ['Ship the ledger move behind a flag.'],
      nextSteps: [
        '[[Tobias Fenn]] Flag the ledger: put the move behind a flag before Friday.',
        '[ ] Book the cut-over room.',
      ],
      notes: '- Cut-over: the ledger is ready; Tobias wants a flag first.',
      transcript: [
        {
          speaker: 'Mara Quill',
          time: '00:00:00',
          text: 'Morning. Shall we start with the ledger?',
        },
        {
          speaker: 'Tobias Fenn',
          time: '00:00:00',
          text: 'Yes. It is ready, but I would like a flag on it first. Note: the flag ships Friday.',
        },
        {
          speaker: 'Room 4',
          time: '00:09:44',
          text: 'Fine by me. ``` Mara Quill: quoted, not a turn ```',
        },
      ],
      sourceUrl: 'https://docs.example.com/d/abc',
    });
  });

  it('becomes a note at the stated day, people linked', () => {
    const { path, text } = meetingNote(fromGeminiNotes(email));
    expect(path).toBe('Meetings/2026/11/2026-11-20 Larkspur sync.md');
    expect(text).toContain('- When: 2026-11-20 14:30\n- With: [[Mara Quill]], [[Tobias Fenn]]\n');
  });

  it('reads the doc-title form, the last date in it, and a given title over the subject', () => {
    const doc = fromGeminiNotes({
      subject: 'Plan for 2026-12-01 - 2026/11/20 10:00 PDT - Notes by Gemini',
    });
    expect(doc).toMatchObject({ title: 'Plan for 2026-12-01', date: '2026-11-20', start: '10:00' });
    const titled = fromGeminiNotes({ subject: 'Notes: "x" October 6 2026', title: 'Weekly sync' });
    expect(titled).toMatchObject({ title: 'Weekly sync', date: '2026-10-06' });
    expect(titled).not.toHaveProperty('start');
    expect(fromGeminiNotes({ subject: 'Sept 3, 2026 at 12:05 am' })).toMatchObject({
      date: '2026-09-03',
      start: '00:05',
    });
  });

  it('refuses a subject with no date, and fields of the wrong type', () => {
    expect(() => fromGeminiNotes({ subject: 'Weekly sync' })).toThrow(MeetingInputError);
    expect(() => fromGeminiNotes({})).toThrow(/no date/);
    expect(() => fromGeminiNotes({ subject: '2026-11-20', summaryMd: 3 })).toThrow('summaryMd');
    expect(() => fromGeminiNotes({ subject: '2026-11-20', attendees: 3 })).toThrow('attendees');
    expect(() => fromGeminiNotes(null)).toThrow('expected an object');
  });

  it('takes attendee records, a name-less address named by its local part in the note', () => {
    const input = fromGeminiNotes({
      subject: '2026-11-20',
      attendees: [{ name: 'mara.quill@example.com' }, { email: 'tobias.fenn@example.com' }, {}],
    });
    expect(input.attendees).toEqual([
      { name: '', email: 'mara.quill@example.com' },
      { name: '', email: 'tobias.fenn@example.com' },
    ]);
    expect(meetingNote(input).text).toContain('- With: [[mara.quill]], [[tobias.fenn]]');
  });
});
