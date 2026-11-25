import {
  hasInlineTranscript,
  linkedTranscriptOf,
  splitInlineTranscript,
  transcriptPathOf,
  withTranscriptLink,
} from './index.ts';

const MEETING = 'Meetings/2026/11/2026-11-17 Larkspur Payroll renewal.md';
const NAME = '2026-11-17 Larkspur Payroll renewal (transcript)';
const LINK = `- Transcript: [[${NAME}]]`;

const lines = (...each: string[]) => each.join('\n');

describe('transcriptPathOf', () => {
  it('puts the transcript under Transcripts/<YYYY>/<MM>/, named after the meeting note', () => {
    expect(transcriptPathOf(MEETING)).toBe(`Transcripts/2026/11/${NAME}.md`);
  });

  it('follows the meeting note’s own name, wherever the note is', () => {
    expect(transcriptPathOf('Projects/Larkspur/2025-03-04 Kickoff (granola 0a1b2c3d).md')).toBe(
      'Transcripts/2025/03/2025-03-04 Kickoff (granola 0a1b2c3d) (transcript).md',
    );
  });

  it('puts a transcript whose meeting name has no date straight under Transcripts/', () => {
    expect(transcriptPathOf('Meetings/Kickoff.md')).toBe('Transcripts/Kickoff (transcript).md');
  });
});

describe('linkedTranscriptOf', () => {
  it('reads the header’s Transcript line, an alias aside', () => {
    expect(linkedTranscriptOf(lines('Call.', '', LINK, '', '## Notes'))).toBe(NAME);
    expect(linkedTranscriptOf(`- Transcript: [[${NAME}|transcript]]\r\n`)).toBe(NAME);
  });

  it('ignores a Transcript line inside a section: it is not the header', () => {
    expect(linkedTranscriptOf(lines('Call.', '', '## Notes', '', LINK))).toBeNull();
  });
});

describe('withTranscriptLink', () => {
  it('goes after the last header item, every other byte kept', () => {
    const note = lines(
      'Call. #meeting',
      '',
      '- When: 2026-11-17',
      '- Source: https://example.com/m',
      '',
      '## Notes',
      '',
      'Hi.',
      '',
    );
    expect(withTranscriptLink(note, NAME)).toBe(
      lines(
        'Call. #meeting',
        '',
        '- When: 2026-11-17',
        '- Source: https://example.com/m',
        LINK,
        '',
        '## Notes',
        '',
        'Hi.',
        '',
      ),
    );
  });

  it('stops at the summary block: a bullet below it is not the header', () => {
    const note = lines('Call.', '', '<!-- dfai-lite:summary v1 -->', '', '> - Key: point', '');
    expect(withTranscriptLink(note, NAME)).toBe(
      lines('Call.', '', LINK, '', '<!-- dfai-lite:summary v1 -->', '', '> - Key: point', ''),
    );
  });

  it('with no header list, stands on its own before the first section, or at the end', () => {
    expect(withTranscriptLink(lines('Call.', '', '## Notes', ''), NAME)).toBe(
      lines('Call.', '', LINK, '', '## Notes', ''),
    );
    expect(withTranscriptLink('Call.\n', NAME)).toBe(lines('Call.', '', LINK, ''));
  });

  it('leaves a note that already links a transcript as it is', () => {
    const note = lines('Call.', '', '- Transcript: [[Other (transcript)]]', '');
    expect(withTranscriptLink(note, NAME)).toBe(note);
  });
});

describe('splitInlineTranscript', () => {
  const turns = lines(
    '**Mara Quill** [00:00:04] Can we keep the rate?',
    '',
    '**Tobias Fenn**   trailing spaces   ',
    '',
    '    indented code-ish line',
  );
  const note = lines(
    'Renewal call. #meeting',
    '',
    '- When: 2026-11-17 09:30–10:15',
    '- With: [[Mara Quill]], [[Tobias Fenn]]',
    '',
    '## Notes',
    '',
    'Rate stays flat.',
    '',
    '## Transcript',
    '',
    turns,
    '',
    '',
  );

  it('moves every byte of the section’s body to the transcript note and links it', () => {
    const split = splitInlineTranscript(MEETING, note);
    expect(split?.moved).toBe(turns);
    expect(split?.transcript).toEqual({
      path: `Transcripts/2026/11/${NAME}.md`,
      text: `Transcript of the meeting [[2026-11-17 Larkspur Payroll renewal]].\n\n${turns}\n`,
    });
    expect(split?.meeting).toBe(
      lines(
        'Renewal call. #meeting',
        '',
        '- When: 2026-11-17 09:30–10:15',
        '- With: [[Mara Quill]], [[Tobias Fenn]]',
        LINK,
        '',
        '## Notes',
        '',
        'Rate stays flat.',
        '',
      ),
    );
  });

  it('keeps a section a person added after the transcript', () => {
    const split = splitInlineTranscript(MEETING, `${note}## Follow-up\n\nCall back.\n`);
    expect(split?.meeting.endsWith('Rate stays flat.\n\n## Follow-up\n\nCall back.\n')).toBe(true);
    expect(split?.moved).toBe(turns);
  });

  it('keeps a `## ` line inside a code fence in the transcript', () => {
    const fenced = lines('Call.', '', '## Transcript', '', '```', '## not a heading', '```', '');
    expect(splitInlineTranscript(MEETING, fenced)?.moved).toBe('```\n## not a heading\n```');
  });

  it('names the link after the transcript path it is given', () => {
    const split = splitInlineTranscript(
      MEETING,
      note,
      'Transcripts/2026/11/Other (transcript) 2.md',
    );
    expect(split?.meeting).toContain('- Transcript: [[Other (transcript) 2]]');
  });

  it('has nothing to do for a note with no inline transcript, an empty one, or a linked one', () => {
    expect(splitInlineTranscript(MEETING, 'Call.\n\n## Notes\n\nHi.\n')).toBeNull();
    expect(splitInlineTranscript(MEETING, 'Call.\n\n## Transcript\n\n\n')).toBeNull();
    expect(splitInlineTranscript(MEETING, `Call.\n\n${LINK}\n\n## Transcript\n\nHi.\n`)).toBeNull();
  });

  it('is done once: the split meeting note has no inline transcript left', () => {
    const split = splitInlineTranscript(MEETING, note);
    expect(hasInlineTranscript(note)).toBe(true);
    expect(hasInlineTranscript(split?.meeting ?? '')).toBe(false);
    expect(splitInlineTranscript(MEETING, split?.meeting ?? '')).toBeNull();
  });
});
