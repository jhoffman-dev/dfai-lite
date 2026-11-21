import { expect, test } from '@playwright/test';

/** The graph on the sample vault: a ghost creates its note; ⌘/Ctrl-click opens a new tab. */
test('graph: clicking a ghost creates the note, ⌘/Ctrl-click opens a new tab', async ({ page }) => {
  await page.goto('/#/graph');
  const tabs = page.getByRole('tablist', { name: 'Tabs', exact: true }).getByRole('tab');
  const left = page.getByRole('region', { name: 'Left pane' });

  await page.locator('[data-node="Welcome.md"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(tabs).toHaveText(['Graph', 'Welcome']);

  await tabs.filter({ hasText: 'Graph' }).click();
  await page.locator('.graph__node--ghost', { hasText: 'Materials list' }).click();
  await expect(left.getByRole('textbox', { name: 'Note title' })).toHaveValue('Materials list');
  await expect(tabs).toHaveText(['Materials list', 'Welcome']);
});
