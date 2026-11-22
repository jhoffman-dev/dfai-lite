import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * A note's pictures, on the sample vault: a picture the note names is drawn
 * from the vault's bytes; one pasted or dropped in is saved under
 * attachments/ and written as DFAI writes it; a resize is saved as an
 * Obsidian size; a click opens it larger and Escape closes it.
 */

const REPORT = '/#/note/Projects%2FPay%20run%20report.md';
const ORIGINAL = [
  'How the parallel pay runs compare, month by month. #project/active #payroll',
  '',
  '![Pay runs by month|320](../attachments/Pay%20runs.png)',
  '',
  'The fourth month is the parallel run with [[Larkspur Payroll]].',
  '',
].join('\n');

async function openReport(page: Page): Promise<Locator> {
  await page.goto(REPORT);
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor.locator('.tag').first()).toBeVisible();
  return editor;
}

/** The note's markdown as the plain-text view (⌘E) shows it, then back to the editor. */
async function markdownOf(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+e');
  const source = page.getByRole('textbox', { name: 'Note markdown' });
  await expect(source).toBeVisible();
  const text = await source.inputValue();
  await page.keyboard.press('ControlOrMeta+e');
  return text;
}

/** The natural width of an image once the webview has decoded it: 0 when it could not. */
const naturalWidth = (image: Locator) =>
  image.evaluate((element) => (element as HTMLImageElement).naturalWidth);

/**
 * A PNG made in the page, as a screenshot pasted from the clipboard or a file
 * dragged from Finder arrives: a File, `image.png` for a paste.
 */
async function sendImage(editor: Locator, how: 'paste' | 'drop', name: string): Promise<void> {
  await editor.evaluate(
    async (element, { how, name }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 60;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#9fc5e8';
      context.fillRect(0, 0, 120, 60);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((made) => resolve(made!), 'image/png'),
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], name, { type: 'image/png' }));
      const box = element.getBoundingClientRect();
      const event =
        how === 'paste'
          ? new ClipboardEvent('paste', {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true,
            })
          : new DragEvent('drop', {
              dataTransfer: transfer,
              bubbles: true,
              cancelable: true,
              clientX: box.left + 20,
              clientY: box.bottom - 10,
            });
      element.dispatchEvent(event);
    },
    { how, name },
  );
}

test('a picture the note names is drawn from the vault, at the size the note gives', async ({
  page,
}) => {
  const editor = await openReport(page);
  const image = editor.getByRole('img', { name: 'Pay runs by month' });
  await expect(image).toBeVisible();
  await expect.poll(() => naturalWidth(image)).toBe(320);
  expect((await image.boundingBox())?.width).toBeCloseTo(320, 0);
  // Viewing changes nothing.
  expect(await markdownOf(page)).toBe(ORIGINAL);
});

test('a pasted picture is saved in attachments/ and written as a relative image', async ({
  page,
}) => {
  const editor = await openReport(page);
  // The caret at the very end of the note, where a click could land on a link pill instead.
  await editor.evaluate((element) =>
    (
      element as HTMLElement & { editor: { commands: { focus(at: string): void } } }
    ).editor.commands.focus('end'),
  );
  await sendImage(editor, 'paste', 'image.png');

  // A paste has no alt text of its own.
  const pasted = editor.locator('img.image__img[alt=""]');
  await expect(pasted).toBeVisible();
  await expect.poll(() => naturalWidth(pasted)).toBe(120);
  await expect
    .poll(() => markdownOf(page))
    .toMatch(/Larkspur Payroll\]\]\.!\[\]\(\.\.\/attachments\/Pasted%20image%20\d{14}\.png\)\n$/);
  // Its folder is in the tree, last at the top level.
  await expect(page.getByRole('treeitem', { name: /attachments/ })).toBeVisible();
});

test('a picture dropped from Finder keeps its name, and a second one is numbered', async ({
  page,
}) => {
  const editor = await openReport(page);
  await sendImage(editor, 'drop', 'Pay runs.png');
  const dropped = editor.getByRole('img', { name: 'Pay runs', exact: true });
  await expect(dropped).toBeVisible();
  await expect
    .poll(() => markdownOf(page))
    .toContain('![Pay runs](../attachments/Pay%20runs%202.png)');
  await expect.poll(() => naturalWidth(dropped)).toBe(120);
});

test('a resize by the handle is saved as the image’s size, and only that changes', async ({
  page,
}) => {
  const editor = await openReport(page);
  const image = editor.getByRole('img', { name: 'Pay runs by month' });
  await expect.poll(() => naturalWidth(image)).toBe(320);
  await image.hover();
  const handle = editor.locator('.image__handle--right');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 100, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => markdownOf(page)).toBe(ORIGINAL.replace('|320]', '|216]'));
});

test('a click opens the picture larger, and Escape closes it', async ({ page }) => {
  const editor = await openReport(page);
  await editor.getByRole('img', { name: 'Pay runs by month' }).click();
  const viewer = page.getByRole('dialog', { name: 'Pay runs by month' });
  await expect(viewer).toBeVisible();
  const large = viewer.getByRole('img', { name: 'Pay runs by month' });
  await expect.poll(() => naturalWidth(large)).toBe(320);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  expect(await markdownOf(page)).toBe(ORIGINAL);
});
