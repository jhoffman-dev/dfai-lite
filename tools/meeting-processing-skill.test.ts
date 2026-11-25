// The meeting-processing skill as Claude reads it: the copy a new vault starts
// with is the skill itself, and its worked example obeys its own rules.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MEETING_QUEUE_PATH } from '../src/domain/meetings/index.ts';

const REPO = join(import.meta.dirname, '..');
const SKILL = 'skills/meeting-processing/SKILL.md';
const read = (path: string) => readFile(join(REPO, path), 'utf8');

/** The first fenced markdown block after `heading` in the skill. */
function fencesAfter(text: string, heading: string): string {
  const after = text.slice(text.indexOf(heading) + heading.length);
  const match = /```markdown\n([\s\S]*?)```/.exec(after);
  return match?.[1] ?? '';
}

describe('the meeting-processing skill', () => {
  it('ships in the vault template exactly as it is installed', async () => {
    expect(await read(`vault-template/${SKILL}`)).toBe(await read(SKILL));
  });

  it('is named where the vault’s CLAUDE.md sends Claude, with the queue’s path', async () => {
    const contract = await read('vault-template/CLAUDE.md');
    expect(contract).toContain(SKILL);
    expect(contract).toContain(MEETING_QUEUE_PATH);
    expect(await read(SKILL)).toContain(MEETING_QUEUE_PATH);
  });

  it('adds only the summary block in its worked example, by its own rules', async () => {
    const skill = await read(SKILL);
    const before = fencesAfter(skill, 'The note before:');
    const after = fencesAfter(skill, 'The note after (only the block is new):');
    const block = /<!-- dfai-lite:summary v1 -->\n[\s\S]*?<!-- \/dfai-lite:summary -->\n\n/.exec(
      after,
    )?.[0];
    expect(block).toBeDefined();
    expect(after.replace(block ?? '', '')).toBe(before);
    expect(block).toMatch(
      /^> \[!summary\] Summary by Claude \(claude-[\w.-]+, \d{4}-\d{2}-\d{2}\)$/m,
    );
    expect(block).not.toContain('[[');
    expect(block).not.toContain('- [ ]');
    expect((block ?? '').length).toBeLessThan(1500);
  });
});
