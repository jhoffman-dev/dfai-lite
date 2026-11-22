import { expect, test, type Page } from '@playwright/test';

/** A folder's row in the tree, by its exact name. */
const folderRow = (page: Page, name: string) =>
  page
    .getByRole('tree', { name: 'Notes' })
    .locator('[role="treeitem"][data-kind="folder"]')
    .filter({ has: page.locator('.sidebar-row-label').getByText(name, { exact: true }) });

const sidebarWidth = async (page: Page) =>
  (await page.getByRole('navigation', { name: 'Sidebar' }).boundingBox())?.width ?? 0;

/** Filing from the Inbox: a new folder, a note dragged into it, its links and its tab following. */
test('a new folder, a note dragged into it, links and the tab following', async ({ page }) => {
  await page.goto('/');
  const tree = page.getByRole('tree', { name: 'Notes' });

  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Reading');
  await page.keyboard.press('Enter');
  const folder = folderRow(page, 'Reading');
  await expect(folder).toBeVisible();

  // Open the Inbox note, then drag its row onto the new, empty folder.
  await folderRow(page, 'Inbox').click();
  const note = tree.getByRole('treeitem', { name: 'Reading list' });
  await note.click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Reading list');
  await note.dragTo(folder);

  // The open tab follows the note to its new path.
  await expect(page).toHaveURL(/#\/note\/Reading%2FReading%20list\.md$/);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Reading list');
  await expect(page.getByRole('button', { name: /now in Reading/ })).toBeVisible();

  // The link to it from another note was rewritten, and still opens it.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('Weekly review');
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.locator('.wikilink', { hasText: 'reading list' }).click();
  await expect(page).toHaveURL(/#\/note\/Reading%2FReading%20list\.md$/);
});

test('the sidebar resizes by its edge, and keeps the width through a reload', async ({ page }) => {
  await page.goto('/');
  const before = await sidebarWidth(page);
  const edge = page.getByRole('separator', { name: 'Resize the sidebar' });
  const box = await edge.boundingBox();
  if (box === null) throw new Error('the sidebar has no edge to drag');
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 200, { steps: 6 });
  await page.mouse.up();
  const after = await sidebarWidth(page);
  expect(after).toBeGreaterThan(before + 100);

  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  expect(Math.abs((await sidebarWidth(page)) - after)).toBeLessThan(2);
});
