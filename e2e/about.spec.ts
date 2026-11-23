import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Settings → About shows the version the build stamped, which is
 * package.json's: read here, so a bump never needs this test changed.
 */
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

test('Settings → About shows the version from package.json and a commit', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'Settings' })
    .click();
  const about = page.getByRole('region', { name: 'About' });
  await expect(about.getByTestId('about-version')).toHaveText(`DFAI Lite ${version}`);
  // A short commit, `+` when built from changes not committed, or `dev` without git.
  await expect(about.getByTestId('about-commit')).toHaveText(/^Built from ([0-9a-f]{7,}\+?|dev)$/);
});
