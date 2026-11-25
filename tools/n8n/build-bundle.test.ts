import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as meetings from '../../src/domain/meetings/index.ts';
import { BUNDLE_PATH, buildBundle } from './build-bundle.ts';

type Bundle = Pick<
  typeof meetings,
  'fromGeminiNotes' | 'meetingNote' | 'mergeMeetingNote' | 'meetingWrite' | 'meetingCommitMessage'
>;

const fixture = async () =>
  JSON.parse(
    await readFile(join(import.meta.dirname, 'fixtures', 'gemini-larkspur-sync.json'), 'utf8'),
  ) as unknown;

/** The committed bundle, run the way an n8n Code node runs it: as a script with nothing imported. */
async function loadBundle(): Promise<Bundle> {
  const code = await readFile(BUNDLE_PATH, 'utf8');
  return new Function(`${code}\nreturn dfaiMeetings;`)() as Bundle;
}

describe('the n8n bundle', () => {
  it('is up to date with its sources (rebuild: node tools/n8n/build-bundle.ts)', async () => {
    expect(await readFile(BUNDLE_PATH, 'utf8')).toBe(await buildBundle());
  });

  it('imports nothing and writes the same note as the domain does', async () => {
    const code = await readFile(BUNDLE_PATH, 'utf8');
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    const bundle = await loadBundle();
    const json = await fixture();
    const input = bundle.fromGeminiNotes(json);
    expect(bundle.meetingNote(input)).toEqual(meetings.meetingNote(meetings.fromGeminiNotes(json)));
    expect(bundle.meetingCommitMessage(input)).toBe('Meeting: 2026-11-20 Larkspur rollout sync');
    const summaryOnly = bundle.meetingNote({ ...input, transcript: [] }).text;
    expect(bundle.mergeMeetingNote(summaryOnly, input)).toBe(bundle.meetingNote(input).text);
    const { path } = bundle.meetingNote(input);
    expect(bundle.meetingWrite(summaryOnly, input, path)).toEqual(
      meetings.meetingWrite(summaryOnly, meetings.fromGeminiNotes(json), path),
    );
    expect(bundle.meetingWrite(summaryOnly, input, path).transcript?.path).toBe(
      'Transcripts/2026/11/2026-11-20 Larkspur rollout sync (transcript).md',
    );
  });

  it('refuses a meeting with no day, as the domain does', async () => {
    const bundle = await loadBundle();
    expect(() => bundle.fromGeminiNotes({ subject: 'Weekly sync' })).toThrow(/no date/);
  });
});
