import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { APPEARANCE_PATH } from '../../application/index.ts';
import type { MemoryVaultFiles } from '../../application/testing/index.ts';
import { keepPageMenuToText } from '../shell/page-menu.ts';
import { giveElementsASize, renderApp, TEST_VAULT } from '../testing/render-app.tsx';

const PLAN = 'Projects/Larkspur Payroll.md';

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

beforeAll(() => {
  giveElementsASize();
  keepPageMenuToText(document);
});
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

const tree = () => screen.getByRole('tree', { name: 'Notes' });
const treeRow = (name: string) =>
  within(tree()).getByText(name).closest('.tree-row') as HTMLElement;
const saved = (files: MemoryVaultFiles) => JSON.parse(files.peek(APPEARANCE_PATH) ?? '{}');

async function openPicker(user: ReturnType<typeof userEvent.setup>, name: string) {
  fireEvent.contextMenu(within(tree()).getByText(name));
  await user.click(screen.getByRole('menuitem', { name: 'Icon & color…' }));
  return screen.getByRole('dialog', { name: `Icon and color for ${name}` });
}

describe('Icon & color…', () => {
  it('colors a folder as a box and swaps its glyph, saved as each is picked', async () => {
    const user = userEvent.setup();
    const { services } = await renderApp();
    const files = services.files as MemoryVaultFiles;
    const picker = await openPicker(user, 'Projects');
    await user.click(within(picker).getByRole('radio', { name: 'Blue' }));
    await waitFor(() => expect(treeRow('Projects')).toHaveAttribute('data-hue', 'blue'));
    expect(saved(files)).toEqual({ Projects: { color: 'blue' } });

    await user.click(within(picker).getByRole('radio', { name: 'Work' }));
    await waitFor(() => expect(treeRow('Projects')).toHaveAttribute('data-look-icon', 'work'));
    expect(treeRow('Projects').querySelector('.tree-chevron')).toBeNull();
    expect(treeRow('Projects').querySelector('.tree-row-icon svg')).not.toBeNull();
    expect(within(picker).getByRole('radio', { name: 'Blue' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(saved(files)).toEqual({ Projects: { color: 'blue', icon: 'work' } });
  });

  it('clears the color with None and the icon with Default', async () => {
    const user = userEvent.setup();
    const { services } = await renderApp({
      files: {
        ...TEST_VAULT,
        [APPEARANCE_PATH]: '{"People": {"color": "green", "icon": "people"}}',
      },
    });
    expect(treeRow('People')).toHaveAttribute('data-hue', 'green');
    const picker = await openPicker(user, 'People');
    await user.click(within(picker).getByRole('radio', { name: 'None' }));
    await waitFor(() => expect(treeRow('People')).not.toHaveAttribute('data-hue'));
    expect(treeRow('People')).toHaveAttribute('data-look-icon', 'people');
    await user.click(within(picker).getByRole('radio', { name: 'Default' }));
    await waitFor(() => expect(treeRow('People')).not.toHaveAttribute('data-look-icon'));
    expect(saved(services.files as MemoryVaultFiles)).toEqual({});
  });

  it('walks the grids with the arrow keys and picks with Enter; Escape closes it', async () => {
    const user = userEvent.setup();
    await renderApp();
    const picker = await openPicker(user, 'Welcome');
    expect(within(picker).getByRole('radio', { name: 'None' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(within(picker).getByRole('radio', { name: 'Brown' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(treeRow('Welcome')).toHaveAttribute('data-hue', 'brown'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Icon and color/ })).toBeNull();
  });

  it('takes one typed emoji as the icon, and nothing that is not one', async () => {
    const user = userEvent.setup();
    const { services } = await renderApp();
    const picker = await openPicker(user, 'Welcome');
    const field = within(picker).getByRole('textbox', { name: 'Emoji' });
    await user.type(field, 'ab');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await user.clear(field);
    fireEvent.change(field, { target: { value: '🚀' } });
    await waitFor(() => expect(treeRow('Welcome')).toHaveAttribute('data-look-icon', '🚀'));
    expect(within(treeRow('Welcome')).getByText('🚀')).toBeInTheDocument();
    expect(saved(services.files as MemoryVaultFiles)).toEqual({ 'Welcome.md': { icon: '🚀' } });
  });

  it('keeps the open note apart from another note of its color', async () => {
    await renderApp({
      files: {
        ...TEST_VAULT,
        [APPEARANCE_PATH]: JSON.stringify({
          [PLAN]: { color: 'pink' },
          'Projects/Garden shed.md': { color: 'pink' },
        }),
      },
    });
    go(`#/note/${encodeURIComponent(PLAN)}`);
    await waitFor(() => expect(treeRow('Larkspur Payroll')).toHaveClass('is-active'));
    expect(treeRow('Larkspur Payroll')).toHaveAttribute('data-hue', 'pink');
    expect(treeRow('Garden shed')).toHaveAttribute('data-hue', 'pink');
    expect(treeRow('Garden shed')).not.toHaveClass('is-active');
  });

  it('shows the look on the favorite, the tab and the page bar too', async () => {
    await renderApp({
      files: {
        ...TEST_VAULT,
        [APPEARANCE_PATH]: JSON.stringify({ [PLAN]: { color: 'orange', icon: 'flag' } }),
      },
    });
    const favorites = screen.getByRole('list', { name: 'Favorites' });
    const favorite = within(favorites).getByText('Larkspur Payroll').closest('li') as HTMLElement;
    expect(favorite).toHaveAttribute('data-hue', 'orange');
    expect(favorite).toHaveAttribute('data-look-icon', 'flag');

    go(`#/note/${encodeURIComponent(PLAN)}`);
    const tab = await screen.findByRole('tab', { name: /Larkspur Payroll/ });
    expect(tab.querySelector('.look-glyph')).toHaveAttribute('data-look-icon', 'flag');
    expect(document.querySelector('.page-bar__crumbs .look-glyph')).toHaveAttribute(
      'data-hue',
      'orange',
    );
  });

  it('is offered on a favorite’s menu as well', async () => {
    const user = userEvent.setup();
    await renderApp();
    const favorites = screen.getByRole('list', { name: 'Favorites' });
    fireEvent.contextMenu(within(favorites).getByText('Larkspur Payroll'));
    await user.click(screen.getByRole('menuitem', { name: 'Icon & color…' }));
    const picker = screen.getByRole('dialog', { name: 'Icon and color for Larkspur Payroll' });
    await user.click(within(picker).getByRole('radio', { name: 'Purple' }));
    await waitFor(() =>
      expect(within(favorites).getByText('Larkspur Payroll').closest('li')).toHaveAttribute(
        'data-hue',
        'purple',
      ),
    );
  });
});
