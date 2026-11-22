import { expect, test, type Page } from '@playwright/test';

/**
 * Click anywhere to type, as Apple Notes does: a new note takes the caret
 * by itself, a press below the last line or beside a line puts it there,
 * and the note's tags show as pills under its title.
 */

const PAYROLL = '/#/note/Projects%2FLarkspur%20Payroll.md';

/** The note's markdown as the plain-text view (⌘E) shows it, then back to the editor. */
async function markdownOf(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+e');
  const source = page.getByRole('textbox', { name: 'Note markdown' });
  await expect(source).toBeVisible();
  const text = await source.inputValue();
  await page.keyboard.press('ControlOrMeta+e');
  return text;
}

test('a new note takes what is typed at once, with no click', async ({ page }) => {
  // The quick-capture address: what the global hotkey and a Shortcut open.
  await page.goto('/#/new');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Untitled');
  await page.keyboard.type('Buy milk');
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveText('Buy milk');

  // The sidebar's New note button, from a note already open.
  await page
    .getByRole('button', { name: /New note/ })
    .first()
    .click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Untitled 2');
  await page.keyboard.type('Call Tobias');
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveText('Call Tobias');
  expect(await markdownOf(page)).toBe('Call Tobias\n');
});

test('a press below the last line types at the end; one beside a line, on that line', async ({
  page,
}) => {
  await page.goto(PAYROLL);
  const text = page.getByRole('textbox', { name: 'Note text' });
  await expect(text.locator('h2').first()).toBeVisible();
  const pane = page.getByRole('tabpanel');
  await pane.evaluate((element) => (element.scrollTop = element.scrollHeight));
  const paneBox = (await pane.boundingBox())!;
  await page.mouse.click(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height - 12);
  await page.keyboard.type('Appended.');
  expect(await markdownOf(page)).toMatch(/\[\[Data migration plan\]\]\n\nAppended\.\n$/);

  await pane.evaluate((element) => (element.scrollTop = 0));
  const goals = text.locator('h2', { hasText: 'Goals' });
  const heading = (await goals.boundingBox())!;
  const column = (await text.boundingBox())!;
  await page.mouse.click(column.x - 40, heading.y + heading.height / 2);
  await page.keyboard.type('Our ');
  await expect(goals).toHaveText('Our Goals');
  await page.mouse.click(column.x + column.width + 30, heading.y + heading.height / 2);
  await page.keyboard.type(' first');
  await expect(goals).toHaveText('Our Goals first');
});

test('the note’s tags show under its title, and a pill opens the tag', async ({ page }) => {
  await page.goto(PAYROLL);
  const row = page.getByRole('article').getByRole('navigation', { name: 'Tags' });
  const pill = row.getByRole('button', { name: '#project/active' });
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(page.getByRole('list', { name: 'Notes tagged project/active' })).toBeVisible();
});
