import { expect, test, type Page } from '@playwright/test';

const tabTitles = (page: Page, pane: 'Tabs' | 'Tabs, right pane') =>
  page.getByRole('tablist', { name: pane, exact: true }).getByRole('tab');

/** Tabs and split screen on the sample vault: open, split, mirror, close, restore. */
test('tabs and split screen: new tab, open to the side, mirrored typing, restore', async ({
  page,
}) => {
  await page.goto('/#/note/Welcome.md');
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
  const left = page.getByRole('region', { name: 'Left pane' });
  const right = page.getByRole('region', { name: 'Right pane' });
  await expect(left.getByRole('textbox', { name: 'Note title' })).toHaveValue('Welcome');

  // ⌘/Ctrl-click opens a second tab beside the first, and the address follows it.
  await sidebar
    .getByRole('list', { name: 'Favourites' })
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
  await leftText.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Mirrored across panes.');
  await expect(right.getByRole('textbox', { name: 'Note text' })).toContainText(
    'Mirrored across panes.',
  );
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
