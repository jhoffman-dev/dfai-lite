import { expect, test, type Page } from '@playwright/test';

const tree = (page: Page) => page.getByRole('tree', { name: 'Notes' });

/** A folder's row in the tree, by its exact name. */
const folderRow = (page: Page, name: string) =>
  tree(page)
    .locator('[role="treeitem"][data-kind="folder"]')
    .filter({ has: page.locator('.sidebar-row-label').getByText(name, { exact: true }) });

const noteRow = (page: Page, name: string) => tree(page).getByRole('treeitem', { name });

async function style(page: Page, row: ReturnType<typeof folderRow>, hue: string, icon: string) {
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Icon & color…' }).click();
  const picker = page.getByRole('dialog', { name: /^Icon and color for / });
  await picker.getByRole('radio', { name: hue }).click();
  await picker.getByRole('radio', { name: icon }).click();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
}

test('a folder and a note wear a color and an icon, and keep them when moved and renamed', async ({
  page,
}) => {
  await page.goto('/');
  await style(page, folderRow(page, 'People'), 'Green', 'People');
  await expect(folderRow(page, 'People')).toHaveAttribute('data-hue', 'green');
  await expect(folderRow(page, 'People')).toHaveAttribute('data-look-icon', 'people');

  await folderRow(page, 'Inbox').click();
  await style(page, noteRow(page, 'Reading list'), 'Yellow', 'Book');
  await expect(noteRow(page, 'Reading list')).toHaveAttribute('data-hue', 'yellow');
  // The box is drawn: a pale fill and a border, the label in the hue's ink.
  const box = await noteRow(page, 'Reading list').evaluate((row) => {
    const css = getComputedStyle(row);
    return { fill: css.backgroundColor, border: css.boxShadow, ink: css.color };
  });
  expect(box.fill).not.toBe('rgba(0, 0, 0, 0)');
  expect(box.border).toContain('inset');

  // The note moves to another folder: its look goes with it.
  await noteRow(page, 'Reading list').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  await page.getByRole('combobox', { name: 'Folder' }).fill('Resources');
  await page.keyboard.press('Enter');
  await folderRow(page, 'Resources').click();
  await expect(noteRow(page, 'Reading list')).toHaveAttribute(
    'href',
    '#/note/Resources%2FReading%20list.md',
  );
  await expect(noteRow(page, 'Reading list')).toHaveAttribute('data-hue', 'yellow');
  await expect(noteRow(page, 'Reading list')).toHaveAttribute('data-look-icon', 'book');

  // The folder is renamed: its look follows.
  await folderRow(page, 'People').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename folder…' }).click();
  await page.getByRole('textbox', { name: 'Folder' }).fill('Team');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(folderRow(page, 'Team')).toHaveAttribute('data-hue', 'green');
  await expect(folderRow(page, 'Team')).toHaveAttribute('data-look-icon', 'people');

  // The open note's tab wears its icon.
  await noteRow(page, 'Reading list').click();
  const tab = page.getByRole('tab', { name: 'Reading list' });
  await expect(tab.locator('.look-glyph')).toHaveAttribute('data-look-icon', 'book');
});
