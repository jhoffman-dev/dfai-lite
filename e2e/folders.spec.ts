import { expect, test, type JSHandle, type Locator, type Page } from '@playwright/test';

/** A folder's row in the tree, by its exact name. */
const folderRow = (page: Page, name: string) =>
  page
    .getByRole('tree', { name: 'Notes' })
    .locator('[role="treeitem"][data-kind="folder"]')
    .filter({ has: page.locator('.sidebar-row-label').getByText(name, { exact: true }) });

/**
 * A drag driven by DOM drag events at each row's middle, one event per
 * step. Playwright's mouse drag sends its `dragover`s only when it next
 * moves, so a pointer resting on a row is never heard resting there; these
 * events say exactly where the pointer is and when.
 */
async function dragEvents(page: Page, from: Locator) {
  const dataTransfer: JSHandle<DataTransfer> = await page.evaluateHandle(() => new DataTransfer());
  const fire = async (type: string, on: Locator) => {
    const box = await on.boundingBox();
    if (box === null) throw new Error(`nothing to ${type} on`);
    const at = { clientX: box.x + 40, clientY: box.y + box.height / 2 };
    await on.dispatchEvent(type, { dataTransfer, ...at });
  };
  // The source's own element: once moved, its row is gone, and the browser ends the drag on it anyway.
  const source = await from.elementHandle();
  await fire('dragstart', from);
  return {
    over: (on: Locator) => fire('dragover', on),
    drop: async (on: Locator) => {
      await fire('drop', on);
      await source?.dispatchEvent('dragend', { dataTransfer });
    },
  };
}

test('a note held over one folder, then dropped on another, lands in the second', async ({
  page,
}) => {
  await page.goto('/');
  await folderRow(page, 'Inbox').click();
  const note = page.getByRole('tree', { name: 'Notes' }).getByRole('treeitem', {
    name: 'Reading list',
  });
  const drag = await dragEvents(page, note);
  const tile = page.getByTestId('tree-drag-tile');
  await expect(tile).toHaveText('Reading list');
  await expect(note).toHaveClass(/is-dragged/);

  await drag.over(folderRow(page, 'Meetings'));
  await expect(folderRow(page, 'Meetings')).toHaveClass(/is-drop-target/);
  await drag.over(folderRow(page, 'People'));
  await expect(folderRow(page, 'People')).toHaveClass(/is-drop-target/);
  await expect(folderRow(page, 'Meetings')).not.toHaveClass(/is-drop-target/);
  await drag.drop(folderRow(page, 'People'));

  await expect(tile).toHaveCount(0);
  // One row of that name, the moved note, now under People, never Meetings.
  await folderRow(page, 'People').click();
  await expect(page.getByRole('treeitem', { name: 'Reading list' })).toHaveAttribute(
    'href',
    '#/note/People%2FReading%20list.md',
  );
});

test('a closed folder held over opens after a second, not before', async ({ page }) => {
  await page.goto('/');
  await page.clock.install();
  await folderRow(page, 'Inbox').click();
  const note = page.getByRole('tree', { name: 'Notes' }).getByRole('treeitem', {
    name: 'Reading list',
  });
  const drag = await dragEvents(page, note);
  await drag.over(folderRow(page, 'People'));
  await page.clock.runFor(500);
  await expect(folderRow(page, 'People')).toHaveAttribute('aria-expanded', 'false');
  await page.clock.runFor(500);
  await expect(folderRow(page, 'People')).toHaveAttribute('aria-expanded', 'true');
  await expect(folderRow(page, 'People')).toHaveClass(/is-drop-target/);
  await drag.drop(folderRow(page, 'People'));
});

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
