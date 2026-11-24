import {
  MEETING_QUEUE_HEADER,
  MEETING_QUEUE_PATH,
  mergeMeetingQueues,
  queuedMeetings,
  queueMeetings,
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
    const theirs = queueOf(line(RENEWAL), `${line(SYNC)} — not processed: no notes yet`);
    const merged = mergeMeetingQueues(ours, theirs);
    expect(merged).toBe(ours);
    const added = queueOf(line(RENEWAL), line('Meetings/2026/11/2026-11-24 Retro.md'));
    const both = mergeMeetingQueues(queueOf(line(SYNC)), added);
    expect(queuedMeetings(both)).toEqual([SYNC, RENEWAL, 'Meetings/2026/11/2026-11-24 Retro.md']);
  });

  it('takes no conflict markers or other text from the other side, and ends on a newline', () => {
    const theirs = `<<<<<<< HEAD\n${line(SYNC)}\n=======\n>>>>>>> origin/main\nProse.`;
    expect(mergeMeetingQueues('Ours, no newline', theirs)).toBe(
      `Ours, no newline\n${line(SYNC)}\n`,
    );
  });
});
