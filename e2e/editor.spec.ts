import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The editor renders a note's markdown rather than showing it: headings,
 * bold, link pills and checkboxes, with none of the markdown's characters
 * on screen. What is typed with markdown shortcuts renders as it is typed,
 * and is written to the note as the markdown it reads as.
 */

const NOTE = '/#/note/Projects%2FLarkspur%20Payroll.md';

/** The sample note's text exactly as the sample vault holds it. */
const ORIGINAL = [
  'Moving Larkspur onto the new payroll system by the **end of the quarter**. #project/active',
  '',
  '## Goals',
  '',
  '- Parallel run for two pay cycles.',
  '- Sign-off from [[Mara Quill]].',
  '',
  '## Cut-over',
  '',
  '- [x] Freeze changes in the old system',
  '- [ ] Run the second parallel cycle',
  '- [ ] Switch the bank file',
  '',
  '| Cycle | Date | Status |',
  '| --- | --- | --- |',
  '| First | 2026-11-28 | Planned |',
  '| Second | 2026-12-12 | Planned |',
  '',
  '```bash',
  'payroll export --cycle 1 --to staging',
  '```',
  '',
  '## Links',
  '',
  '- [[2026-11-14 Larkspur kickoff]]',
  '- [[2026-11-21 Weekly sync]]',
  '- [[Data migration plan]]',
  '',
].join('\n');

async function openNote(page: Page): Promise<Locator> {
  await page.goto(NOTE);
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor.locator('h2').first()).toBeVisible();
  return editor;
}

/** The note's markdown as the plain-text view (⌘E) shows it, then back to the editor. */
async function markdownOf(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+e');
  const source = page.getByRole('textbox', { name: 'Note markdown' });
  await expect(source).toBeVisible();
  const text = await source.inputValue();
  await page.keyboard.press('ControlOrMeta+e');
  return text;
}

test('a note renders: headings, bold, link pills, tags, checkboxes and a table, no markdown', async ({
  page,
}) => {
  const editor = await openNote(page);
  await expect(editor.locator('h2', { hasText: 'Goals' })).toBeVisible();
  await expect(editor.locator('strong', { hasText: 'end of the quarter' })).toBeVisible();
  await expect(editor.locator('a.wikilink', { hasText: 'Mara Quill' })).toBeVisible();
  await expect(editor.locator('.tag', { hasText: '#project/active' })).toBeVisible();
  const boxes = editor.getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.first()).toBeChecked();
  await expect(boxes.nth(1)).not.toBeChecked();
  await expect(editor.locator('table th', { hasText: 'Status' })).toBeVisible();
  await expect(editor.locator('pre code', { hasText: 'payroll export' })).toBeVisible();

  // What is on screen is the words, and none of the markdown around them.
  const shown = await editor.innerText();
  expect(shown).toContain('Parallel run for two pay cycles.');
  for (const syntax of ['##', '**', '[[', ']]', '- [ ]', '| ---', '```']) {
    expect(shown).not.toContain(syntax);
  }
});

test('typing markdown shortcuts renders as typed, and writes the markdown it reads as', async ({
  page,
}) => {
  const editor = await openNote(page);
  expect(await markdownOf(page)).toBe(ORIGINAL);

  // The empty line the editor keeps under a last list, to type after it.
  await editor.locator(':scope > p').last().click();
  await page.keyboard.type('## Title');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Some **bold** text');

  await expect(editor.locator('h2', { hasText: 'Title' })).toBeVisible();
  await expect(editor.locator('strong', { hasText: 'bold' })).toBeVisible();
  expect(await editor.innerText()).not.toContain('**');
  await expect.poll(() => markdownOf(page)).toBe(`${ORIGINAL}\n## Title\n\nSome **bold** text\n`);

  // Ticking a box writes the tick, and only the tick.
  await editor.getByRole('checkbox').nth(1).check();
  await expect
    .poll(() => markdownOf(page))
    .toBe(
      `${ORIGINAL.replace('- [ ] Run the second', '- [x] Run the second')}\n## Title\n\nSome **bold** text\n`,
    );
});
