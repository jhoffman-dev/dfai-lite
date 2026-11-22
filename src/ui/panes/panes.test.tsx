import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memoryLayoutStorage } from './layout-storage.ts';
import { giveElementsASize, renderApp } from '../testing/render-app.tsx';

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

const tabs = (pane = 'Tabs') =>
  within(screen.getByRole('tablist', { name: pane }))
    .getAllByRole('tab')
    .map((tab) => tab.querySelector('.tab-strip__title')?.textContent);

/** A note's link in the sidebar: in the favorites if it is one, else in the tree. */
const treeRow = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Sidebar' }))
    .getAllByText(name)[0]
    ?.closest('a') as HTMLElement;

beforeAll(giveElementsASize);
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('tabs', () => {
  it('replaces the active tab on a click, and opens a new tab on ⌘/Ctrl-click', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    expect(tabs()).toEqual(['Welcome']);
    await userEvent.click(treeRow('Larkspur Payroll'));
    expect(tabs()).toEqual(['Larkspur Payroll']);

    fireEvent.click(treeRow('Garden shed'), { ctrlKey: true });
    expect(tabs()).toEqual(['Larkspur Payroll', 'Garden shed']);
    expect(window.location.hash).toBe('#/note/Projects%2FGarden%20shed.md');
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Garden shed');
  });

  it('focuses the tab already showing a note instead of opening it again', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    fireEvent.click(treeRow('Larkspur Payroll'), { metaKey: true });
    await userEvent.click(treeRow('Welcome'));
    expect(tabs()).toEqual(['Welcome', 'Larkspur Payroll']);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Welcome');
  });

  it('opens a note to the side from its menu, and closing that pane’s tab unsplits', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    fireEvent.contextMenu(treeRow('Larkspur Payroll'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open to the side' }));
    expect(tabs('Tabs')).toEqual(['Welcome']);
    expect(tabs('Tabs, right pane')).toEqual(['Larkspur Payroll']);
    expect(screen.getByRole('separator', { name: 'Resize panes' })).toBeInTheDocument();

    await userEvent.keyboard('{Alt>}w{/Alt}');
    expect(screen.queryByRole('tablist', { name: 'Tabs, right pane' })).toBeNull();
    expect(tabs()).toEqual(['Welcome']);
  });

  it('follows a renamed note in every tab, and closes the tabs of a deleted one', async () => {
    const { services } = await renderApp();
    await go('#/note/Welcome.md');
    fireEvent.click(treeRow('Larkspur Payroll'), { ctrlKey: true });
    const title = await screen.findByRole('textbox', { name: 'Note title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Payroll move{Enter}');
    await waitFor(() => expect(tabs()).toEqual(['Welcome', 'Payroll move']));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.contextMenu(treeRow('Payroll move'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    await waitFor(() => expect(tabs()).toEqual(['Welcome']));
    expect(services.session.file('Projects/Payroll move.md')).toBeNull();
  });

  it('keeps each tab’s own view, the editor or the markdown', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    fireEvent.click(treeRow('Larkspur Payroll'), { ctrlKey: true });
    const markdown = () => screen.getByRole('button', { name: 'Markdown' });
    expect(markdown()).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(markdown());
    expect(markdown()).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('tab', { name: /Welcome/ }));
    expect(markdown()).toHaveAttribute('aria-pressed', 'true');
  });

  it('moves the active tab left and right from the keyboard', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    fireEvent.click(treeRow('Larkspur Payroll'), { ctrlKey: true });
    fireEvent.click(treeRow('Garden shed'), { ctrlKey: true });
    fireEvent.keyDown(window, { code: 'ArrowLeft', metaKey: true, altKey: true, shiftKey: true });
    expect(tabs()).toEqual(['Welcome', 'Garden shed', 'Larkspur Payroll']);
    fireEvent.keyDown(window, { code: 'PageDown', ctrlKey: true, shiftKey: true });
    expect(tabs()).toEqual(['Welcome', 'Larkspur Payroll', 'Garden shed']);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Garden shed');
  });

  it('lists the keyboard shortcuts from the sidebar, ⌘? and the palette', async () => {
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Move the tab right')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();

    fireEvent.keyDown(window, { code: 'Slash', metaKey: true, shiftKey: true });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await userEvent.type(screen.getByRole('combobox'), '?{Enter}');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('restores the saved tabs, dropping one whose note is gone', async () => {
    const layout = memoryLayoutStorage({
      panes: [
        {
          tabs: [
            { id: 't1', view: { kind: 'note', path: 'Welcome.md' }, source: true },
            { id: 't2', view: { kind: 'note', path: 'Gone.md' }, source: true },
          ],
          activeTab: 't2',
        },
        { tabs: [{ id: 't3', view: { kind: 'graph' }, source: false }], activeTab: 't3' },
      ],
      activePane: 0,
      split: 0.4,
    });
    await renderApp({ layout });
    expect(tabs()).toEqual(['Welcome']);
    expect(tabs('Tabs, right pane')).toEqual(['Graph']);
    expect(window.location.hash).toBe('#/note/Welcome.md');
    expect(screen.getByRole('separator', { name: 'Resize panes' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
  });
});
