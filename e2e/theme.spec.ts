import { expect, test } from '@playwright/test';

/**
 * Settings → Appearance: Dark turns the window dark at once, the editor
 * included, and is kept across a reload; System hands the theme back to
 * the system's preference.
 */
test('the theme switches to dark and back to the system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#/note/Projects%2FLarkspur%20Payroll.md');
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeVisible();
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'light');

  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  // The page under the editor is the dark surface (tokens.css: #18181b).
  const pane = page.locator('.pane').first();
  await expect(pane).toHaveCSS('background-color', 'rgb(24, 24, 27)');
  await expect(editor).toHaveCSS('color', 'rgb(237, 237, 239)');

  // Kept for this device: a reload opens dark, before and after the app runs.
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(root).toHaveAttribute('data-theme', 'dark');

  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await page.getByRole('radio', { name: 'System' }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(pane).toHaveCSS('background-color', 'rgb(24, 24, 27)');
});
