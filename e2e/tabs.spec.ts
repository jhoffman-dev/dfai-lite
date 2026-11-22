import { expect, test, type Page } from '@playwright/test';

const tabTitles = (page: Page, pane: 'Tabs' | 'Tabs, right pane') =>
  page.getByRole('tablist', { name: pane, exact: true }).getByRole('tab');

/** Tabs and split screen on the sample vault: open, split, mirror, close, restore. */
test('tabs and split screen: new tab, open to the side, mirrored typing, restore', async ({
  page,
}) => {
  // A fake clock, so the focus check below can run every pending timer first.
  await page.clock.install();
  await page.goto('/#/note/Welcome.md');
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
  const left = page.getByRole('region', { name: 'Left pane' });
  const right = page.getByRole('region', { name: 'Right pane' });
  await expect(left.getByRole('textbox', { name: 'Note title' })).toHaveValue('Welcome');

  // ⌘/Ctrl-click opens a second tab beside the first, and the address follows it.
  await sidebar
    .getByRole('list', { name: 'Favorites' })
    .getByRole('link', { name: 'Larkspur Payroll' })
    .click({ modifiers: ['ControlOrMeta'] });
  await expect(tabTitles(page, 'Tabs')).toHaveText(['Welcome', 'Larkspur Payroll']);
  await expect(left.getByRole('tab', { selected: true })).toHaveText('Larkspur Payroll');
  await expect(page).toHaveURL(/#\/note\/Projects%2FLarkspur%20Payroll\.md$/);

  // "Open to the side" splits the window: each pane shows its own note.
  await sidebar
    .getByRole('tree', { name: 'Notes' })
    .getByText('Welcome')
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open to the side' }).click();
  await expect(tabTitles(page, 'Tabs, right pane')).toHaveText(['Welcome']);
  await expect(left.getByRole('textbox', { name: 'Note title' })).toHaveValue('Larkspur Payroll');
  await expect(right.getByRole('textbox', { name: 'Note title' })).toHaveValue('Welcome');

  // The same note in both panes stays one text: typing on the left shows on the right.
  await left.getByRole('tab', { name: /Welcome/ }).click();
  const leftText = left.getByRole('textbox', { name: 'Note text' });
  // At the very start of the first line, clear of the note's link and tag pills.
  await leftText
    .locator('p')
    .first()
    .click({ position: { x: 1, y: 4 } });
  await page.keyboard.type('Mirrored across panes. ');
  await expect(right.getByRole('textbox', { name: 'Note text' })).toContainText(
    'Mirrored across panes.',
  );
  // Whatever the mirror sets off later must not pull the caret to the right pane either.
  await page.clock.runFor(5_000);
  await expect(leftText).toBeFocused();

  // Reload: the panes, tabs and active tab come back.
  await page.reload();
  await expect(tabTitles(page, 'Tabs')).toHaveText(['Welcome', 'Larkspur Payroll']);
  await expect(tabTitles(page, 'Tabs, right pane')).toHaveText(['Welcome']);
  await expect(left.getByRole('tab', { selected: true })).toHaveText('Welcome');

  // Closing the right pane's only tab closes the pane; closing a tab leaves one.
  await right.getByRole('button', { name: 'Close Welcome' }).click();
  await expect(page.getByRole('tablist', { name: 'Tabs, right pane' })).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Resize panes' })).toHaveCount(0);
  await left.getByRole('button', { name: 'Close Welcome' }).click();
  await expect(tabTitles(page, 'Tabs')).toHaveText(['Larkspur Payroll']);

  await page.reload();
  await expect(tabTitles(page, 'Tabs')).toHaveText(['Larkspur Payroll']);
  await expect(page.getByRole('tablist', { name: 'Tabs, right pane' })).toHaveCount(0);
});

/** Dragging tabs onto a pane's content, and moving one with the keyboard. */
test('tabs: drag onto a pane to split or move, keys to reorder', async ({ page }) => {
  await page.goto('/#/note/Welcome.md');
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
  const left = page.getByRole('region', { name: 'Left pane' });
  const right = page.getByRole('region', { name: 'Right pane' });
  await sidebar
    .getByRole('list', { name: 'Favorites' })
    .getByRole('link', { name: 'Larkspur Payroll' })
    .click({ modifiers: ['ControlOrMeta'] });
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('Garden shed');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(tabTitles(page, 'Tabs')).toHaveText(['Welcome', 'Larkspur Payroll', 'Garden shed']);

  // ⌘⌥⇧← moves the active tab one place left.
  await page.keyboard.press('ControlOrMeta+Alt+Shift+ArrowLeft');
  await expect(tabTitles(page, 'Tabs')).toHaveText(['Welcome', 'Garden shed', 'Larkspur Payroll']);

  // A tab dropped on the right half of the only pane splits the window.
  const panel = left.getByRole('tabpanel');
  const box = await panel.boundingBox();
  if (box === null) throw new Error('The left pane has no size');
  await left
    .getByRole('tab', { name: /Larkspur Payroll/ })
    .dragTo(panel, { targetPosition: { x: box.width * 0.75, y: box.height / 2 } });
  await expect(tabTitles(page, 'Tabs')).toHaveText(['Welcome', 'Garden shed']);
  await expect(tabTitles(page, 'Tabs, right pane')).toHaveText(['Larkspur Payroll']);

  // A tab dropped anywhere on the other pane's content moves there.
  await left.getByRole('tab', { name: /Welcome/ }).dragTo(right.getByRole('tabpanel'));
  await expect(tabTitles(page, 'Tabs')).toHaveText(['Garden shed']);
  await expect(tabTitles(page, 'Tabs, right pane')).toHaveText(['Larkspur Payroll', 'Welcome']);
  await expect(right.getByRole('textbox', { name: 'Note title' })).toHaveValue('Welcome');
});
