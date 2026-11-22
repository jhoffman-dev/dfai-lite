import { expect, test, type Locator, type Page } from '@playwright/test';

const titleIn = (pane: Locator) => pane.getByRole('textbox', { name: 'Note title' });
const backIn = (pane: Locator) => pane.getByRole('button', { name: 'Back', exact: true });
const forwardIn = (pane: Locator) => pane.getByRole('button', { name: 'Forward', exact: true });

/** Follows the `[[name]]` link in the note a pane shows. */
async function follow(pane: Locator, name: string) {
  await pane
    .getByRole('textbox', { name: 'Note text' })
    .locator('.wikilink', { hasText: name })
    .first()
    .click();
  await expect(titleIn(pane)).toHaveValue(name);
}

const panes = (page: Page) => ({
  left: page.getByRole('region', { name: 'Left pane' }),
  right: page.getByRole('region', { name: 'Right pane' }),
});

/** Each tab's own Back and Forward on the sample vault: links, keys, tabs, panes, a reload. */
test('back and forward: per tab, per pane, by button and key, across a reload', async ({
  page,
}) => {
  await page.goto('/#/note/Welcome.md');
  const { left, right } = panes(page);
  await expect(titleIn(left)).toHaveValue('Welcome');
  await expect(backIn(left)).toBeDisabled();

  // A → B by a link; Back shows A, Forward shows B.
  await follow(left, 'Larkspur Payroll');
  await expect(backIn(left)).toHaveAttribute('title', /^Back to Welcome \(/);
  await backIn(left).click();
  await expect(titleIn(left)).toHaveValue('Welcome');
  await expect(page).toHaveURL(/#\/note\/Welcome\.md$/);
  await forwardIn(left).click();
  await expect(titleIn(left)).toHaveValue('Larkspur Payroll');

  // The keys do the same: ⌘/Ctrl+[ and ], and a browser's Alt+← and Alt+→.
  await page.keyboard.press('ControlOrMeta+BracketLeft');
  await expect(titleIn(left)).toHaveValue('Welcome');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(titleIn(left)).toHaveValue('Larkspur Payroll');

  // A second tab starts empty and keeps its own; the first tab's is untouched.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('Reading list');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(titleIn(left)).toHaveValue('Reading list');
  await expect(backIn(left)).toBeDisabled();
  await follow(left, 'Weekly review');
  await left.getByRole('tab', { name: /Larkspur Payroll/ }).click();
  await expect(backIn(left)).toHaveAttribute('title', /^Back to Welcome \(/);
  await left.getByRole('tab', { name: /Weekly review/ }).click();
  await backIn(left).click();
  await expect(titleIn(left)).toHaveValue('Reading list');

  // Split: each pane's Back is its own.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('Tobias Fenn');
  await page.keyboard.press('Alt+Enter');
  await expect(titleIn(right)).toHaveValue('Tobias Fenn');
  await expect(backIn(right)).toBeDisabled();
  await follow(right, 'Mara Quill');
  await expect(forwardIn(left)).toBeEnabled();
  await backIn(right).click();
  await expect(titleIn(right)).toHaveValue('Tobias Fenn');
  await expect(titleIn(left)).toHaveValue('Reading list');

  // A reload keeps every tab's history.
  await page.reload();
  await expect(titleIn(right)).toHaveValue('Tobias Fenn');
  await expect(forwardIn(right)).toHaveAttribute('title', /^Forward to Mara Quill \(/);
  await forwardIn(left).click();
  await expect(titleIn(left)).toHaveValue('Weekly review');
  await left.getByRole('tab', { name: /Larkspur Payroll/ }).click();
  await backIn(left).click();
  await expect(titleIn(left)).toHaveValue('Welcome');
});

/** Back returns a long note to where it was scrolled; a fresh open starts at the top. */
test('back and forward: the scroll comes back with the note', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 420 });
  await page.goto('/#/note/Projects%2FLarkspur%20Payroll.md');
  const { left } = panes(page);
  const panel = left.getByRole('tabpanel');
  await expect(titleIn(left)).toHaveValue('Larkspur Payroll');
  await follow(left, 'Data migration plan');
  await expect(panel).toHaveJSProperty('scrollTop', 0);

  await backIn(left).click();
  await expect(titleIn(left)).toHaveValue('Larkspur Payroll');
  await panel.evaluate((element) => {
    element.scrollTop = 200;
  });
  // Each place keeps its own: Forward is back at the top of the plan, not at 200.
  await forwardIn(left).click();
  await expect(titleIn(left)).toHaveValue('Data migration plan');
  await expect(panel).toHaveJSProperty('scrollTop', 0);
  await backIn(left).click();
  await expect(titleIn(left)).toHaveValue('Larkspur Payroll');
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(195);
});
