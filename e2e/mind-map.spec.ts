import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, name: string) =>
  page.getByRole('tree', { name: 'Mind map' }).getByRole('treeitem', { name, exact: true });

/**
 * The mind map on the sample vault: opened from a note's bar beside it,
 * walked (expand, a repeat, open a note, re-root and back along the trail),
 * and bound to the window however far it is opened.
 */
test('mind map: open from a note, expand, open a note, re-root, stay in the window', async ({
  page,
}) => {
  await page.goto('/#/note/Projects%2FLarkspur%20Payroll.md');
  const left = page.getByRole('region', { name: 'Left pane' });
  const right = page.getByRole('region', { name: 'Right pane' });
  await left.getByRole('button', { name: 'Map' }).click();

  // It opens beside the note, rooted on it, its branches open.
  await expect(right.getByRole('tab', { name: 'Map: Larkspur Payroll' })).toBeVisible();
  await expect(node(page, 'Larkspur Payroll')).toHaveAttribute('aria-level', '1');
  await expect(node(page, 'Links, 4')).toBeVisible();
  await expect(node(page, 'Tags, 1')).toBeVisible();
  await expect(node(page, '#project/active')).toBeVisible();

  // Expanding a note loads its own branches; the way back is a repeat, not a loop.
  const before = await page.getByRole('treeitem').count();
  await right.getByRole('button', { name: 'Expand Mara Quill' }).first().click();
  await expect(node(page, 'Larkspur Payroll, already on the map').first()).toBeVisible();
  expect(await page.getByRole('treeitem').count()).toBeGreaterThan(before);

  // However far it is opened, the map stays inside the window.
  const stage = await right.locator('.mind-map__stage').boundingBox();
  const viewport = page.viewportSize();
  expect(stage?.height ?? Infinity).toBeLessThanOrEqual(viewport?.height ?? 0);
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(pageHeight).toBeLessThanOrEqual(viewport?.height ?? 0);

  // A click on a note's label opens it in the other pane; the map stays.
  await node(page, 'Tobias Fenn').first().getByRole('button').first().click();
  await expect(left.getByRole('textbox', { name: 'Note title' })).toHaveValue('Tobias Fenn');
  await expect(node(page, 'Larkspur Payroll')).toBeVisible();
  // Another opens in the same place: walking the map does not pile up tabs.
  await node(page, 'Mara Quill').first().getByRole('button').first().click();
  await expect(left.getByRole('textbox', { name: 'Note title' })).toHaveValue('Mara Quill');
  await expect(left.getByRole('tab')).toHaveCount(1);

  // Focus re-roots the map there; the trail leads back.
  await right.getByRole('button', { name: 'Focus the map on Mara Quill' }).first().click();
  await expect(right.getByRole('tab', { name: 'Map: Mara Quill' })).toBeVisible();
  const trail = right.getByRole('navigation', { name: 'Map trail' });
  await expect(trail.getByRole('button')).toHaveText(['Larkspur Payroll', 'Mara Quill']);
  await trail.getByRole('button', { name: 'Larkspur Payroll' }).click();
  await expect(right.getByRole('tab', { name: 'Map: Larkspur Payroll' })).toBeVisible();
});

test('mind map: the keyboard walks it, and a tag opens one', async ({ page }) => {
  await page.goto('/#/map/note/Projects%2FLarkspur%20Payroll.md');
  const root = node(page, 'Larkspur Payroll');
  await root.focus();
  await page.keyboard.press('ArrowRight');
  await expect(node(page, 'Links, 4')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('treeitem', { name: /^Backlinks, \d+$/ })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('treeitem', { name: /^Backlinks/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(root).toBeFocused();

  // The shortcut maps the open note beside it; Follow keeps it on whichever note is open.
  await page.goto('/#/note/Projects%2FLarkspur%20Payroll.md');
  await page.getByRole('textbox', { name: 'Note title' }).focus();
  await page.keyboard.press('ControlOrMeta+Shift+G');
  const right = page.getByRole('region', { name: 'Right pane' });
  await expect(right.getByRole('tab', { name: 'Map: Larkspur Payroll' })).toBeVisible();
  await right.getByRole('button', { name: 'Follow open note' }).click();
  await expect(right.getByRole('tab', { name: 'Mind map' })).toBeVisible();
  await expect(node(page, 'Larkspur Payroll')).toHaveAttribute('aria-level', '1');
  await node(page, 'Mara Quill').first().getByRole('button').first().click();
  await expect(node(page, 'Mara Quill')).toHaveAttribute('aria-level', '1');

  // From the tags page: a tag's own map.
  await page.goto('/#/tags/payroll');
  await page.getByRole('button', { name: 'Mind map', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Map: #payroll' })).toBeVisible();
  await expect(node(page, 'Pay run report')).toBeVisible();

  // From a tag pill under a note's title, and from a note's row in the sidebar.
  await page.goto('/#/note/Projects%2FGarden%20shed.md');
  await page
    .getByRole('navigation', { name: 'Tags' })
    .getByRole('button')
    .first()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open mind map' }).click();
  await expect(page.getByRole('tab', { name: 'Map: #project/someday' })).toBeVisible();
  await page
    .getByRole('tree', { name: 'Notes' })
    .getByRole('treeitem', { name: 'Welcome', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open mind map' }).click();
  await expect(page.getByRole('tab', { name: 'Map: Welcome' })).toBeVisible();
  await expect(node(page, 'Welcome')).toHaveAttribute('aria-level', '1');
});
