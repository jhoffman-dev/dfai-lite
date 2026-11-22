import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { giveElementsASize, renderApp } from '../testing/render-app.tsx';

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

const treeRow = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Sidebar' }))
    .getAllByText(name)[0]
    ?.closest('a') as HTMLElement;

const shownTitle = () => screen.getByRole('textbox', { name: 'Note title' });
const back = () => screen.getByRole('button', { name: 'Back' });
const forward = () => screen.getByRole('button', { name: 'Forward' });

beforeAll(giveElementsASize);
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Back and Forward in the page bar', () => {
  it('are disabled on a tab with nowhere to go, and say where they go when not', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    expect(back()).toBeDisabled();
    expect(forward()).toBeDisabled();
    expect(back()).toHaveAttribute('title', 'Back');

    await userEvent.click(treeRow('Larkspur Payroll'));
    expect(back()).toBeEnabled();
    expect(back()).toHaveAttribute('title', 'Back to Welcome (Alt+←)');
    expect(forward()).toBeDisabled();
  });

  it('step the tab back and forward on a click, the address following', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    await userEvent.click(treeRow('Larkspur Payroll'));

    await userEvent.click(back());
    expect(shownTitle()).toHaveValue('Welcome');
    expect(window.location.hash).toBe('#/note/Welcome.md');
    expect(forward()).toHaveAttribute('title', 'Forward to Larkspur Payroll (Alt+→)');

    await userEvent.click(forward());
    expect(shownTitle()).toHaveValue('Larkspur Payroll');
    expect(window.location.hash).toBe('#/note/Projects%2FLarkspur%20Payroll.md');
  });

  it('never add to the webview’s own history, which has nothing to go back through', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    const length = window.history.length;
    await userEvent.click(treeRow('Larkspur Payroll'));
    await userEvent.click(treeRow('Garden shed'));
    await userEvent.click(back());
    expect(window.history.length).toBe(length);
  });

  it('answer ⌘[ and ⌘], Alt+← and Alt+→, and a mouse’s back and forward buttons', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    await userEvent.click(treeRow('Larkspur Payroll'));

    fireEvent.keyDown(window, { code: 'BracketLeft', key: '[', metaKey: true });
    expect(shownTitle()).toHaveValue('Welcome');
    fireEvent.keyDown(window, { code: 'BracketRight', key: ']', metaKey: true });
    expect(shownTitle()).toHaveValue('Larkspur Payroll');
    fireEvent.keyDown(window, { code: 'ArrowLeft', key: 'ArrowLeft', altKey: true });
    expect(shownTitle()).toHaveValue('Welcome');
    fireEvent.keyDown(window, { code: 'ArrowRight', key: 'ArrowRight', altKey: true });
    expect(shownTitle()).toHaveValue('Larkspur Payroll');
    fireEvent.mouseUp(window, { button: 3 });
    expect(shownTitle()).toHaveValue('Welcome');
    fireEvent.mouseUp(window, { button: 4 });
    expect(shownTitle()).toHaveValue('Larkspur Payroll');
  });

  it('leave ⌘⇧[ and ⌘⇧] to the tabs', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    await userEvent.click(treeRow('Larkspur Payroll'));
    fireEvent.keyDown(window, { code: 'BracketLeft', key: '{', metaKey: true, shiftKey: true });
    expect(shownTitle()).toHaveValue('Larkspur Payroll');
  });

  it('start empty in a new tab, and step only the tab they are in', async () => {
    await renderApp();
    await go('#/note/Welcome.md');
    await userEvent.click(treeRow('Larkspur Payroll'));
    fireEvent.click(treeRow('Garden shed'), { ctrlKey: true });
    expect(back()).toBeDisabled();

    await userEvent.click(screen.getByRole('tab', { name: /Larkspur Payroll/ }));
    await userEvent.click(back());
    expect(shownTitle()).toHaveValue('Welcome');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      expect.stringContaining('Welcome'),
      expect.stringContaining('Garden shed'),
    ]);
  });
});
