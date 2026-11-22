import { fromGranola } from './granola-notes.ts';
import { MeetingInputError } from './meeting-input.ts';
import { meetingNote } from './meeting-note.ts';

/** A fictional Granola note, `GET /v1/notes/{id}?include=transcript` as the API sends it. */
const NOTE = {
  id: 'not_Lk7pQ2rTs9vWx3',
  object: 'note',
  title: 'Larkspur Payroll renewal',
  owner: { name: 'Mara Quill', email: 'mara.quill@example.com' },
  updated_at: '2026-11-17T17:41:03Z',
  web_url: 'https://notes.granola.ai/d/5f1e7c2a-0b3d-4e6f-9a8b-1c2d3e4f5a6b',
  calendar_event: {
    event_title: 'Larkspur Payroll renewal (calendar)',
    invitees: [
      { email: 'mara.quill@example.com' },
      { email: 'TOBIAS.FENN@example.com' },
      { email: 'payroll-team@example.com' },
    ],
    scheduled_start_time: '2026-11-17T18:00:00Z',
    scheduled_end_time: '2026-11-17T18:30:00Z',
  },
  attendees: [
    { name: 'Mara Quill', email: 'mara.quill@example.com' },
    { name: null, email: 'tobias.fenn@example.com' },
  ],
  summary_text: 'Plain text the note does not use when markdown is there.',
  summary_markdown:
    '## Renewal\n\nLarkspur Payroll renews at the current price. Notice is sixty days.\n\n- Tobias sends the redline today\n\n## Notes\n\nA heading named like a section.',
  private_notes_text: 'plain',
  private_notes_markdown: '- Ask about the **onboarding** credit',
  transcript: [
    {
      speaker: { source: 'microphone', attribution: 'me' },
      text: 'Morning, Tobias.',
      start_time: '2026-11-17T18:01:05Z',
      end_time: '2026-11-17T18:01:09Z',
    },
    {
      speaker: { source: 'speaker', attribution: 'them', name: 'Tobias *Fenn*' },
      text: '  Sixty days   works. ',
      start_time: '2026-11-17T18:01:11.400Z',
      end_time: '2026-11-17T18:01:16Z',
    },
    { speaker: { source: 'speaker', attribution: 'them' }, text: '   ', start_time: null },
    { speaker: { source: 'speaker' }, text: 'Who said this?', start_time: 'yesterday' },
  ],
};

const LA = { timeZone: 'America/Los_Angeles', selfEmails: [] };

describe('fromGranola', () => {
  it('maps the title, the times on the zone’s clock, and the source', () => {
    const input = fromGranola(NOTE, LA);
    expect(input).toMatchObject({
      title: 'Larkspur Payroll renewal',
      date: '2026-11-17',
      start: '10:00',
      end: '10:30',
      sourceUrl: NOTE.web_url,
    });
  });

  it('merges the attendees and invitees by address, a name winning, mailing lists left out', () => {
    expect(fromGranola(NOTE, LA).attendees).toEqual([
      { name: 'Mara Quill', email: 'mara.quill@example.com' },
      { name: '', email: 'tobias.fenn@example.com' },
    ]);
  });

  it('keeps Granola’s headings inside the Summary, and a heading named like a section as bold text', () => {
    const { summary } = fromGranola(NOTE, LA);
    expect(summary).toContain('### Renewal');
    expect(summary).toContain('**Notes**');
    expect(summary).not.toMatch(/^## /m);
    expect(summary).not.toContain('Plain text');
  });

  it('takes the owner’s own notes as Notes, the markdown before the plain text', () => {
    expect(fromGranola(NOTE, LA).notes).toBe('- Ask about the **onboarding** credit');
  });

  it('names each turn and stamps it with its time of day, dropping a turn with no words', () => {
    expect(fromGranola(NOTE, LA).transcript).toEqual([
      { speaker: 'Mara Quill', time: '10:01:05', text: 'Morning, Tobias.' },
      { speaker: 'Tobias Fenn', time: '10:01:11', text: 'Sixty days works.' },
      { speaker: 'Unknown', text: 'Who said this?' },
    ]);
  });

  it('writes `me` as You only when the owner is one of the person’s addresses', () => {
    const mine = fromGranola(NOTE, { ...LA, selfEmails: ['MARA.QUILL@example.com'] });
    expect(mine.transcript?.[0]?.speaker).toBe('You');
    const shared = fromGranola({ ...NOTE, owner: null }, LA);
    expect(shared.transcript?.[0]?.speaker).toBe('Unknown');
  });

  it('becomes a note in the vault contract’s shape, the transcript last', () => {
    const { path, text } = meetingNote(fromGranola(NOTE, LA));
    expect(path).toBe('Meetings/2026/11/2026-11-17 Larkspur Payroll renewal.md');
    expect(text.split('\n').slice(0, 6)).toEqual([
      'Larkspur Payroll renews at the current price. #meeting',
      '',
      '- When: 2026-11-17 10:00–10:30',
      '- With: [[Mara Quill]], [[tobias.fenn]]',
      `- Source: ${NOTE.web_url}`,
      '',
    ]);
    const headings = text.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## Summary', '## Notes', '## Transcript']);
    expect(text).toContain('**Tobias Fenn** [10:01:11] Sixty days works.');
  });

  it('with no calendar event, takes the times from the turns, and the title from the note', () => {
    const input = fromGranola({ ...NOTE, calendar_event: null }, LA);
    expect(input).toMatchObject({ date: '2026-11-17', start: '10:01', end: '10:01' });
  });

  it('with no title of its own, takes the calendar event’s', () => {
    expect(fromGranola({ ...NOTE, title: '  ' }, LA).title).toBe(
      'Larkspur Payroll renewal (calendar)',
    );
  });

  it('cleans a title that cannot be a file name, in the path only', () => {
    const input = fromGranola({ ...NOTE, title: 'Q4: plan / review #2 [draft]?' }, LA);
    expect(input.title).toBe('Q4: plan / review #2 [draft]?');
    expect(meetingNote(input).path).toBe('Meetings/2026/11/2026-11-17 Q4 plan review 2 draft.md');
  });

  it('writes an end on a later day with its date, and none when the clock shows it before the start', () => {
    const late = {
      ...NOTE,
      calendar_event: {
        scheduled_start_time: '2026-11-18T07:30:00Z',
        scheduled_end_time: '2026-11-18T08:30:00Z',
      },
    };
    expect(fromGranola(late, LA)).toMatchObject({ date: '2026-11-17', end: '2026-11-18 00:30' });
    const fallBack = {
      ...NOTE,
      calendar_event: {
        scheduled_start_time: '2026-11-01T08:30:00Z',
        scheduled_end_time: '2026-11-01T09:10:00Z',
      },
    };
    const input = fromGranola(fallBack, LA);
    expect(input.start).toBe('01:30');
    expect(input.end).toBeUndefined();
  });

  it('leaves out what Granola did not send', () => {
    const bare = { id: 'not_B2', title: 'Hallway chat', calendar_event: null, transcript: [] };
    expect(() => fromGranola(bare, LA)).toThrow(MeetingInputError);
    const timed = {
      ...bare,
      transcript: [{ text: 'Hi', start_time: '2026-11-17T18:00:00+02:00' }],
    };
    const input = fromGranola(timed, LA);
    expect(input).toEqual({
      title: 'Hallway chat',
      date: '2026-11-17',
      start: '08:00',
      end: '08:00',
      attendees: [],
      transcript: [{ speaker: 'Unknown', time: '08:00:00', text: 'Hi' }],
    });
  });

  it('refuses a note it cannot read, by name', () => {
    expect(() => fromGranola('nope', LA)).toThrow('the Granola note: expected an object');
    expect(() => fromGranola({ ...NOTE, attendees: 'x' }, LA)).toThrow(
      'attendees: expected a list',
    );
    expect(() => fromGranola({ ...NOTE, title: 7 }, LA)).toThrow('title: expected text');
    expect(() => fromGranola({ ...NOTE, title: null, calendar_event: null }, LA)).toThrow(
      'title: missing',
    );
    expect(() => fromGranola(NOTE, { ...LA, timeZone: 'Mars/Olympus' })).toThrow(
      'is not a time zone',
    );
  });

  it('never reads an instant without an offset on the Mac’s own clock', () => {
    const noOffset = {
      ...NOTE,
      calendar_event: null,
      transcript: [{ text: 'Hi', start_time: '2026-11-17T18:00:00' }],
    };
    expect(() => fromGranola(noOffset, LA)).toThrow('has no start');
  });

  it('writes a picture from the web as a link, so opening the note loads nothing', () => {
    const input = fromGranola(
      {
        ...NOTE,
        summary_markdown:
          'See ![the chart](https://cdn.example.com/chart.png) and ![](http://example.com/a.png).\n\n<img src="https://example.com/b.png" alt="b">\n\nRef ![x][chart]\n\n[[Larkspur rollout]] and [the plan](https://example.com/plan).',
        private_notes_markdown: '```\n![kept in code](https://example.com/c.png)\n```',
        transcript: [{ text: 'Look ![](https://example.com/d.png)', start_time: null }],
      },
      LA,
    );
    expect(input.summary).toBe(
      'See [the chart](https://cdn.example.com/chart.png) and [image](http://example.com/a.png).\n\n[image](https://example.com/b.png)\n\nRef [x][chart]\n\n[[Larkspur rollout]] and [the plan](https://example.com/plan).',
    );
    expect(input.notes).toContain('![kept in code]');
    expect(input.transcript?.[0]?.text).toBe('Look [image](https://example.com/d.png)');
  });
});
