import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Callout types: a callout's block menu changes its type, saved as only
 * that callout's `[!type]`; a type added in Settings is offered in the
 * menu, drawn in its hue, and still there when the note is opened again.
 */

const NOTE = '/#/note/Projects%2FGarden%20shed.md';

async function openNote(page: Page): Promise<Locator> {
  await page.goto(NOTE);
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor.locator('.callout').first()).toBeVisible();
  return editor;
}

/** The note's markdown as the plain-text view (⌘E) shows it, then back to the editor. */
async function markdownOf(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+e');
  const source = page.getByRole('textbox', { name: 'Note markdown' });
  await expect(source).toBeVisible();
  const text = await source.inputValue();
  await page.keyboard.press('ControlOrMeta+e');
  await expect(source).toHaveCount(0);
  return text;
}

/** Opens the block menu of `block` from the handle beside it. */
async function blockMenuOf(page: Page, block: Locator): Promise<Locator> {
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  if (box === null) throw new Error('The block is not drawn.');
  await page.mouse.move(box.x + 8, box.y + 6);
  const handle = page.locator('[data-block-handle]');
  await expect(handle).toBeVisible();
  await handle.click();
  const menu = page.getByRole('menu', { name: 'Block' });
  await expect(menu).toBeVisible();
  return menu;
}

async function pickType(page: Page, menu: Locator, row: string, type: string): Promise<void> {
  await menu.getByRole('menuitem', { name: row }).click();
  const types = page.getByRole('menu', { name: row });
  await expect(types).toBeVisible();
  await types.getByRole('menuitemradio', { name: type }).click();
  await expect(menu).toHaveCount(0);
}

test('a callout’s type is changed from its block menu, in the saved text too', async ({ page }) => {
  const editor = await openNote(page);
  const callout = editor.locator('.callout').first();
  await expect(callout).toHaveAttribute('data-hue', 'blue');

  const menu = await blockMenuOf(page, callout.locator('.callout__body p'));
  await menu.getByRole('menuitem', { name: 'Callout type' }).click();
  const types = page.getByRole('menu', { name: 'Callout type' });
  await expect(types.getByRole('menuitemradio', { name: 'Note' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await types.getByRole('menuitemradio', { name: 'Tip' }).click();

  await expect(callout).toHaveAttribute('data-callout', 'tip');
  await expect(callout).toHaveAttribute('data-hue', 'green');
  const text = await markdownOf(page);
  expect(text).toContain('> [!tip] Before ordering\n> Measure the plot twice.');
  expect(text).toContain('> [!warning]\n> Check the boundary');
});

test('a type added in Settings is offered, drawn in its color, and kept', async ({ page }) => {
  const editor = await openNote(page);
  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'Settings' })
    .click();
  const section = page.getByRole('region', { name: 'Callouts' });
  await section.getByRole('button', { name: 'Add a type' }).click();
  const form = section.getByRole('form', { name: 'New callout type' });
  await form.getByRole('textbox', { name: /Name/ }).fill('decision');
  await form.getByRole('radio', { name: 'Purple' }).click();
  await form.getByRole('radio', { name: 'Flag' }).click();
  await expect(form.locator('.callout--preview')).toHaveAttribute('data-hue', 'purple');
  await form.getByRole('button', { name: 'Add type' }).click();
  await expect(section.getByRole('list', { name: 'Your callout types' })).toContainText(
    '[!decision]',
  );
  await page.getByRole('button', { name: 'Close settings' }).click();

  const warning = editor.locator('.callout').nth(1);
  const menu = await blockMenuOf(page, warning.locator('.callout__body p'));
  await pickType(page, menu, 'Callout type', 'Decision');
  await expect(warning).toHaveAttribute('data-callout', 'decision');
  await expect(warning).toHaveAttribute('data-hue', 'purple');
  await expect(warning.locator('.callout__title')).toHaveCSS('color', 'rgb(77, 69, 133)');
  expect(await markdownOf(page)).toContain('> [!decision]\n> Check the boundary');

  // Opened again (another note, then back): the type is the vault's, not the editor's.
  await page.goto('/#/note/Welcome.md');
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeVisible();
  const again = await openNote(page);
  await expect(again.locator('.callout').nth(1)).toHaveAttribute('data-hue', 'purple');
  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Callouts' })
      .getByRole('list', { name: 'Your callout types' }),
  ).toContainText('[!decision]');
});
