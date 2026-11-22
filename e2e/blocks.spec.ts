import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * A block's handle, as DFAI's: hovering a block shows the ⋮⋮ beside it;
 * dragging the ⋮⋮ moves the block, on screen and in the saved text; a click
 * on it opens the block's menu, whose rows add and delete blocks.
 */

const NOTE = '/#/note/Projects%2FLarkspur%20Payroll.md';
const INTRO =
  'Moving Larkspur onto the new payroll system by the **end of the quarter**. #project/active';

async function openNote(page: Page): Promise<Locator> {
  await page.goto(NOTE);
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor.locator('h2').first()).toBeVisible();
  return editor;
}

/** The note's markdown as the plain-text view (⌘E) shows it, then back to the editor. */
async function markdownOf(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+e');
  const source = page.getByRole('textbox', { name: 'Note markdown' });
  await expect(source).toBeVisible();
  const text = await source.inputValue();
  // The markdown view has no handle: there are no blocks to drag in it.
  await expect(page.locator('[data-block-handle]:visible')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+e');
  await expect(source).toHaveCount(0);
  return text;
}

/** Points at `block` near its left edge, where the hand goes to reach its handle. */
async function hover(page: Page, block: Locator): Promise<Locator> {
  // The note's tags row sits above the text: a block near the end may start below the fold.
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  if (box === null) throw new Error('The block is not drawn.');
  await page.mouse.move(box.x + 8, box.y + 6);
  const handle = page.locator('[data-block-handle]');
  await expect(handle).toBeVisible();
  return handle;
}

/** Whether the handle sits in the gutter left of `block`, level with its first line. */
async function besideOf(handle: Locator, block: Locator): Promise<boolean> {
  const [at, of] = [await handle.boundingBox(), await block.boundingBox()];
  if (at === null || of === null) return false;
  return at.x + at.width <= of.x && at.y >= of.y - 4 && at.y < of.y + 24;
}

test('a block is dragged by its handle above another, on screen and in the saved text', async ({
  page,
}) => {
  const editor = await openNote(page);
  const intro = editor.locator(':scope > p').first();
  const goals = editor.locator('h2', { hasText: 'Goals' });

  const handle = await hover(page, intro);
  expect(await besideOf(handle, intro)).toBe(true);
  await expect(handle).toHaveText('⋮⋮');

  // Each list item has a handle of its own, beside its marker.
  const item = editor.locator('li', { hasText: 'Parallel run' });
  expect(await besideOf(await hover(page, item), item)).toBe(true);

  // Drag the heading's handle to the top half of the first paragraph.
  const grip = await hover(page, goals);
  const from = await grip.boundingBox();
  const to = await intro.boundingBox();
  if (from === null || to === null) throw new Error('Not drawn.');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 40, to.y + 10, { steps: 8 });
  await expect(page.locator('.editor-drop-line')).toBeVisible();
  await page.mouse.move(to.x + 40, to.y + 4, { steps: 2 });
  await page.mouse.up();

  await expect(editor.locator(':scope > *').first()).toHaveText('Goals');
  await expect(editor.locator(':scope > *').nth(1)).toContainText('Moving Larkspur');
  await expect.poll(() => markdownOf(page)).toMatch(/^## Goals\n\nMoving Larkspur onto/);
  const saved = await markdownOf(page);
  // Only the order changed: the heading took its own bytes up, and the rest kept theirs.
  expect(saved).toContain(`## Goals\n\n${INTRO}\n\n- Parallel run for two pay cycles.`);
});

/** Drags the handle of `block` by the mouse and lets it go over `target`. */
async function dragBlockOnto(page: Page, block: Locator, target: Locator): Promise<void> {
  const grip = await hover(page, block);
  const [from, to] = [await grip.boundingBox(), await target.boundingBox()];
  if (from === null || to === null) throw new Error('Not drawn.');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(8, to.height / 2), { steps: 8 });
  await page.mouse.up();
}

test('a block dragged in one pane shows in the other; dropped on the tree or a tab strip, nothing', async ({
  page,
}) => {
  const editor = await openNote(page);
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
  await sidebar
    .getByRole('tree', { name: 'Notes' })
    .getByText('Larkspur Payroll')
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open to the side' }).click();
  const left = page.getByRole('region', { name: 'Left pane' });
  const right = page.getByRole('region', { name: 'Right pane' });
  const leftText = left.getByRole('textbox', { name: 'Note text' });
  const rightText = right.getByRole('textbox', { name: 'Note text' });
  await expect(rightText.locator('h2').first()).toBeVisible();
  const before = await markdownOf(page);

  // Onto a folder row of the tree, the other pane's tab strip, this pane's own: nothing moves.
  const goals = leftText.locator('h2', { hasText: 'Goals' });
  for (const target of [
    sidebar.getByRole('tree', { name: 'Notes' }).getByText('Projects', { exact: true }),
    page.getByRole('tablist', { name: 'Tabs, right pane' }),
    page.getByRole('tablist', { name: 'Tabs', exact: true }),
  ]) {
    await dragBlockOnto(page, goals, target);
    await expect(leftText.locator(':scope > *').nth(1)).toHaveText('Goals');
  }
  await expect(
    page.getByRole('tablist', { name: 'Tabs, right pane' }).getByRole('tab'),
  ).toHaveCount(1);
  expect(await markdownOf(page)).toBe(before);

  // Within the left pane: the move shows in the right one, the same note.
  await dragBlockOnto(page, goals, leftText.locator(':scope > p').first());
  await expect(leftText.locator(':scope > *').first()).toHaveText('Goals');
  await expect(rightText.locator(':scope > *').first()).toHaveText('Goals');

  // Into the other pane's editor, on the same note or another: refused, nothing taken
  // from this note and nothing put in that one.
  const moved = await markdownOf(page);
  const links = leftText.locator('h2', { hasText: 'Links' });
  await dragBlockOnto(page, links, rightText.locator(':scope > p').first());
  await expect(rightText.locator('h2', { hasText: 'Links' })).toHaveCount(1);
  await expect(links).toHaveCount(1);
  expect(await markdownOf(page)).toBe(moved);

  await sidebar
    .getByRole('tree', { name: 'Notes' })
    .getByText('Welcome')
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open to the side' }).click();
  await expect(rightText).toContainText('Welcome to DFAI Lite');
  const welcome = await rightText.innerText();
  await dragBlockOnto(page, links, rightText.locator(':scope > p').first());
  await expect(links).toHaveCount(1);
  expect(await rightText.innerText()).toBe(welcome);
  await expect(editor.locator('h2', { hasText: 'Links' })).toHaveCount(1);
});

test('the block menu, from the handle: add a heading below a paragraph, then delete it', async ({
  page,
}) => {
  const editor = await openNote(page);
  const intro = editor.locator(':scope > p').first();

  await (await hover(page, intro)).click();
  const menu = page.getByRole('menu', { name: 'Block' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Turn into callout/,
    /Add block above/,
    /Add block below/,
    /Duplicate/,
    /Move up/,
    /Move down/,
    /Delete/,
  ]);
  await expect(menu.getByRole('menuitem', { name: /Move up/ })).toHaveAttribute('data-disabled');
  await menu.getByRole('menuitem', { name: /Add block below/ }).click();
  await expect(menu).toBeHidden();
  await expect(editor).toBeFocused();
  await page.keyboard.type('## Next steps');
  await expect(editor.locator('h2', { hasText: 'Next steps' })).toBeVisible();
  await expect.poll(() => markdownOf(page)).toContain(`${INTRO}\n\n## Next steps\n\n## Goals`);

  // Delete it from its own handle's menu. (⌘/ opens it too, in the app's WebKit;
  // Chromium on a Mac sends no key event for ⌘/, so the unit tests press it.)
  await (await hover(page, editor.locator('h2', { hasText: 'Next steps' }))).click();
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /Delete/ }).click();
  await expect(editor.locator('h2', { hasText: 'Next steps' })).toHaveCount(0);
  await expect.poll(() => markdownOf(page)).toContain(`${INTRO}\n\n## Goals`);
  expect(await markdownOf(page)).not.toContain('Next steps');
});
