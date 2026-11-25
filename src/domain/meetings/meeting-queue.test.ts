import {
  MEETING_QUEUE_HEADER,
  MEETING_QUEUE_PATH,
  mergeMeetingQueues,
  queuedMeetings,
  hasMeetingSummary,
  isMeetingNotePath,
  queuedMeetingsNotice,
  queueMeetings,
  unsummarizedMeetings,
} from './meeting-queue.ts';

const RENEWAL = 'Meetings/2026/11/2026-11-17 Larkspur Payroll renewal.md';
const SYNC = 'Meetings/2026/11/2026-11-21 Weekly sync.md';
const KICKOFF = 'Meetings/2026/11/2026-11-14 Larkspur kickoff.md';

const line = (path: string, added = '2026-11-20') => `- [[${path.slice(0, -3)}]] added ${added}`;
const queueOf = (...lines: string[]) =>
  `${MEETING_QUEUE_HEADER}${lines.map((l) => `${l}\n`).join('')}`;

describe('the meetings queue', () => {
  it('is a note beside the meetings, outside any month', () => {
    expect(MEETING_QUEUE_PATH).toBe('Meetings/Processing queue.md');
  });

  it('starts with its header, then one linked line per meeting with the day it was added', () => {
    const text = queueMeetings(null, [{ path: RENEWAL, added: '2026-11-20' }]);
    expect(text).toBe(
      `${MEETING_QUEUE_HEADER}- [[Meetings/2026/11/2026-11-17 Larkspur Payroll renewal]] added 2026-11-20\n`,
    );
    expect(queuedMeetings(text)).toEqual([RENEWAL]);
  });

  it('adds after the lines it has, keeping everything else byte for byte', () => {
    const before = `${queueOf(line(RENEWAL))}A word James typed.`;
    const text = queueMeetings(before, [{ path: SYNC, added: '2026-11-21' }]);
    expect(text).toBe(`${before}\n${line(SYNC, '2026-11-21')}\n`);
  });

  it('never queues a note twice: listed already, or twice in one go', () => {
    const before = queueOf(`${line(RENEWAL)} — not processed: the transcript is empty`);
    expect(queueMeetings(before, [{ path: RENEWAL, added: '2026-11-22' }])).toBe(before);
    const twice = queueMeetings(null, [
      { path: SYNC, added: '2026-11-21' },
      { path: SYNC, added: '2026-11-21' },
    ]);
    expect(queuedMeetings(twice)).toEqual([SYNC]);
    expect(twice.split(SYNC.slice(0, -3)).length).toBe(2);
  });

  it('reads only entry lines: not the header, prose, a task, or a link mid-sentence', () => {
    const text = [
      'Meetings waiting, see [[Meetings/2026/11/2026-11-14 Larkspur kickoff]].',
      '- [ ] a to-do',
      '- plain bullet',
      `${line(SYNC)}\r`,
      '- [[Meetings/2026/11/2026-11-17 Larkspur Payroll renewal|renewal]] added 2026-11-20',
    ].join('\n');
    expect(queuedMeetings(text)).toEqual([SYNC]);
  });

  it('merges both Macs’ queues, this Mac’s text first, losing no queued line', () => {
    const base = queueOf(line(RENEWAL), line(SYNC));
    const ours = `${base}${line(KICKOFF)}\n`;
    const theirs = queueOf(line(SYNC));
    expect(mergeMeetingQueues(ours, theirs)).toBe(ours);
    const added = queueOf(line(RENEWAL), line('Meetings/2026/11/2026-11-24 Retro.md'));
    const both = mergeMeetingQueues(queueOf(line(SYNC)), added);
    expect(queuedMeetings(both)).toEqual([SYNC, RENEWAL, 'Meetings/2026/11/2026-11-24 Retro.md']);
  });

  it('takes no conflict markers or blank lines from the other side, and ends on a newline', () => {
    const theirs = `<<<<<<< HEAD\n${line(SYNC)}\n=======\n\n>>>>>>> origin/main\n`;
    expect(mergeMeetingQueues('Ours, no newline', theirs)).toBe(
      `Ours, no newline\n${line(SYNC)}\n`,
    );
  });

  it('carries across what the person typed on the other side, once', () => {
    const ours = queueOf(line(SYNC));
    const theirs = `${queueOf(line(SYNC))}Ask Mara about the cache.\n`;
    const merged = mergeMeetingQueues(ours, theirs);
    expect(merged).toBe(`${ours}Ask Mara about the cache.\n`);
    expect(mergeMeetingQueues(merged, theirs)).toBe(merged);
  });

  it('keeps the other side’s line for a meeting when only it says why Claude could not do it', () => {
    const reasoned = `${line(SYNC)} — not processed: no transcript or notes yet`;
    const ours = queueOf(line(RENEWAL), line(SYNC), line(KICKOFF));
    expect(mergeMeetingQueues(ours, queueOf(reasoned))).toBe(
      queueOf(line(RENEWAL), reasoned, line(KICKOFF)),
    );
    const ownReason = queueOf(`${line(SYNC)} — not processed: note not found`);
    expect(mergeMeetingQueues(ownReason, queueOf(reasoned))).toBe(ownReason);
  });

  it('writes new lines in the file’s own line ending', () => {
    const crlf = queueOf(line(SYNC)).replace(/\n/g, '\r\n');
    expect(queueMeetings(crlf, [{ path: RENEWAL, added: '2026-11-20' }])).toBe(
      `${crlf}${line(RENEWAL)}\r\n`,
    );
    const reasoned = `${line(SYNC)} — not processed: note not found`;
    const merged = mergeMeetingQueues(crlf, queueOf(reasoned, line(KICKOFF)));
    expect(merged).toBe(queueOf(reasoned, line(KICKOFF)).replace(/\n/g, '\r\n'));
  });

  it('knows a note that already has Claude’s summary block', () => {
    expect(hasMeetingSummary('One.\n\n<!-- dfai-lite:summary v1 -->\n\n> [!summary] S\n')).toBe(
      true,
    );
    expect(hasMeetingSummary('One. <!-- dfai-lite:summary v1 --> in a sentence\n')).toBe(false);
  });
});

describe('the meetings without a summary', () => {
  it('are the meeting notes with no summary block, sorted: not the queue, transcripts or conflict copies', () => {
    const notes = [
      { path: SYNC, text: 'Sync.\n' },
      { path: RENEWAL, text: 'Renewal.\n\n<!-- dfai-lite:summary v1 -->\n' },
      { path: KICKOFF, text: 'Kickoff.\n' },
      { path: MEETING_QUEUE_PATH, text: MEETING_QUEUE_HEADER },
      {
        path: 'Meetings/2026/11/2026-11-14 Larkspur kickoff (conflict from Studio).md',
        text: 'Kickoff.\n',
      },
      { path: 'Transcripts/2026/11/2026-11-14 Larkspur kickoff (transcript).md', text: 'Hi.\n' },
      { path: 'Meetings/diagram.png', text: '' },
      { path: 'Projects/Larkspur.md', text: 'Not a meeting.\n' },
    ];
    expect(unsummarizedMeetings(notes)).toEqual([KICKOFF, SYNC]);
    expect(isMeetingNotePath(MEETING_QUEUE_PATH)).toBe(false);
  });

  it('are counted in a notice', () => {
    expect(queuedMeetingsNotice(0)).toBe('Every meeting has a summary or is already in the queue.');
    expect(queuedMeetingsNotice(1)).toBe('Queued 1 meeting for Claude to summarize.');
    expect(queuedMeetingsNotice(12)).toBe('Queued 12 meetings for Claude to summarize.');
  });
});
