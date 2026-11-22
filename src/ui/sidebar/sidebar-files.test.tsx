import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemoryVaultFiles } from '../../application/testing/index.ts';
import { keepPageMenuToText } from '../shell/page-menu.ts';
import { giveElementsASize, renderApp, TEST_VAULT } from '../testing/render-app.tsx';

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

/** What a drag carries, as jsdom has no DataTransfer of its own. */
function transfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    clearData: () => data.clear(),
    setDragImage: () => undefined,
  };
}

const VAULT = { ...TEST_VAULT, 'Inbox/Payroll idea.md': 'Ask [[Mara Quill]].\n' };

beforeAll(() => {
  giveElementsASize();
  keepPageMenuToText(document);
  // jsdom has no pointer capture; the edge asks for it on every press.
  HTMLElement.prototype.setPointerCapture = () => undefined;
});
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

const tree = () => screen.getByRole('tree', { name: 'Notes' });

describe('a new folder', () => {
  it('is named in place in the tree, and made empty on disk', async () => {
    const user = userEvent.setup();
    const { services } = await renderApp({ files: VAULT });
    await user.click(screen.getByRole('button', { name: 'New folder' }));
    const field = screen.getByRole('textbox', { name: 'New folder name' });
    await user.type(field, 'a:b');
    expect(screen.getByRole('alert')).toHaveTextContent('cannot hold :');
    await user.clear(field);
    await user.type(field, 'Areas{Enter}');
    expect(await within(tree()).findByText('Areas')).toBeInTheDocument();
    expect((services.files as MemoryVaultFiles).folders()).toContain('Areas');
  });

  it('is made inside a folder from its menu, and Escape lets it go', async () => {
    const user = userEvent.setup();
    const { services } = await renderApp({ files: VAULT });
    fireEvent.contextMenu(within(tree()).getByText('Projects'));
    await user.click(screen.getByRole('menuitem', { name: 'New folder here' }));
    await user.type(screen.getByRole('textbox', { name: 'New folder name' }), 'Garden{Enter}');
    expect(await within(tree()).findByText('Garden')).toBeInTheDocument();
    expect((services.files as MemoryVaultFiles).folders()).toContain('Projects/Garden');

    await user.click(screen.getByRole('button', { name: 'New folder' }));
    await user.keyboard('Gone{Escape}');
    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull();
    expect((services.files as MemoryVaultFiles).folders()).not.toContain('Gone');
  });
});

describe('a row’s menu', () => {
  it('opens on a right click though the web view’s own menu is turned off there', async () => {
    await renderApp({ files: VAULT });
    const row = within(tree()).getByText('Welcome');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => void row.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('menu', { name: 'Note actions' })).toBeInTheDocument();
  });

  it('opens from the “…” on the row, without a right click', async () => {
    const user = userEvent.setup();
    await renderApp({ files: VAULT });
    await user.click(screen.getByRole('button', { name: 'More for Inbox' }));
    const menu = screen.getByRole('menu', { name: 'Folder actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Move to…' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete folder…' })).toBeInTheDocument();
  });
});

describe('the folder picker', () => {
  it('filters the folders as typed and moves the note, its links following', async () => {
    const user = userEvent.setup();
    const { services } = await renderApp({ files: VAULT });
    await go('#/note/Inbox%2FPayroll%20idea.md');
    await user.click(await screen.findByRole('button', { name: /Move to another folder/ }));
    const picker = screen.getByRole('dialog', { name: 'Move to' });
    await user.keyboard('proj');
    const options = within(picker).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Projects', 'New folder “proj”']);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(services.session.file('Projects/Payroll idea.md')).not.toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Move to' })).toBeNull();
  });

  it('marks the folder the note is in, and makes a new folder to move into', async () => {
    const user = userEvent.setup();
    const { services } = await renderApp({ files: VAULT });
    fireEvent.contextMenu(within(tree()).getByText('Inbox'));
    await user.click(screen.getByRole('menuitem', { name: 'Move to…' }));
    const picker = screen.getByRole('dialog', { name: 'Move to' });
    expect(within(picker).getByRole('option', { name: /Top of the vault/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('Archive');
    await user.click(within(picker).getByRole('option', { name: 'New folder “Archive”' }));
    await waitFor(() =>
      expect(services.session.file('Archive/Inbox/Payroll idea.md')).not.toBeNull(),
    );
  });
});

describe('dragging in the tree', () => {
  it('moves a note dropped on a folder, lighting the folder while held over it', async () => {
    const { services } = await renderApp({ files: VAULT });
    const dataTransfer = transfer();
    fireEvent.click(within(tree()).getByText('Inbox'));
    const note = await within(tree()).findByText('Payroll idea');
    const folder = within(tree()).getByText('People').closest('[role="treeitem"]') as Element;
    fireEvent.dragStart(note, { dataTransfer });
    fireEvent.dragOver(folder, { dataTransfer });
    expect(folder).toHaveClass('is-drop-target');
    fireEvent.drop(folder, { dataTransfer });
    await waitFor(() => expect(services.session.file('People/Payroll idea.md')).not.toBeNull());
    expect(folder).not.toHaveClass('is-drop-target');
  });

  it('drops into the folder lit at the release, though a folder held over before it would have opened above it', async () => {
    const { services } = await renderApp({ files: VAULT });
    const dataTransfer = transfer();
    fireEvent.click(within(tree()).getByText('Inbox'));
    fireEvent.click(within(tree()).getByText('Projects'));
    const note = await within(tree()).findByText('Payroll idea');
    const row = (name: string) =>
      within(tree()).getByText(name).closest('[role="treeitem"]') as HTMLElement;
    const projectsAt = row('Projects').dataset['index'];

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.dragStart(note, { dataTransfer });
      // On the closed People for a moment, then on to the open Projects below it, and held there.
      fireEvent.dragOver(row('People'), { dataTransfer });
      act(() => vi.advanceTimersByTime(200));
      fireEvent.dragOver(row('Projects'), { dataTransfer });
      act(() => vi.advanceTimersByTime(1500));
    } finally {
      vi.useRealTimers();
    }
    expect(row('Projects')).toHaveClass('is-drop-target');

    // The pointer has not moved: the drop lands on whatever row is now where Projects was.
    const under = tree().querySelector(`[data-index="${projectsAt}"]`) as Element;
    fireEvent.drop(under, { dataTransfer });
    await waitFor(() => expect(services.session.file('Inbox/Payroll idea.md')).toBeNull());
    const landed = ['People', 'Projects'].filter(
      (folder) => services.session.file(`${folder}/Payroll idea.md`) !== null,
    );
    expect(landed).toEqual(['Projects']);
  });

  it('lights the open folder a note is held over, with its rows, and drops into it', async () => {
    const { services } = await renderApp({ files: VAULT });
    const dataTransfer = transfer();
    fireEvent.click(within(tree()).getByText('Inbox'));
    fireEvent.click(within(tree()).getByText('Projects'));
    const note = await within(tree()).findByText('Payroll idea');
    const projects = within(tree()).getByText('Projects').closest('[role="treeitem"]');
    const inside = within(tree()).getByText('Garden shed');
    fireEvent.dragStart(note, { dataTransfer });
    expect(note.closest('[role="treeitem"]')).toHaveClass('is-dragged');
    expect(screen.getByTestId('tree-drag-tile')).toHaveTextContent('Payroll idea');

    fireEvent.dragOver(inside, { dataTransfer });
    expect(projects).toHaveClass('is-drop-target');
    expect(inside.closest('.tree-slot')).toHaveClass('is-in-drop-target');
    expect(inside.closest('[role="treeitem"]')).not.toHaveClass('is-drop-target');
    fireEvent.drop(inside, { dataTransfer });
    await waitFor(() => expect(services.session.file('Projects/Payroll idea.md')).not.toBeNull());
    expect(screen.queryByTestId('tree-drag-tile')).toBeNull();
  });

  it('drops at the top of the vault from the space around the rows or a note there', async () => {
    const { services } = await renderApp({ files: VAULT });
    const dataTransfer = transfer();
    fireEvent.click(within(tree()).getByText('Inbox'));
    const note = await within(tree()).findByText('Payroll idea');
    const section = tree().closest('section') as Element;
    fireEvent.dragStart(note, { dataTransfer });
    fireEvent.dragOver(tree(), { dataTransfer });
    expect(section).toHaveClass('is-drop-root');
    fireEvent.dragOver(within(tree()).getByText('Welcome'), { dataTransfer });
    expect(section).toHaveClass('is-drop-root');
    fireEvent.drop(within(tree()).getByText('Welcome'), { dataTransfer });
    await waitFor(() => expect(services.session.file('Payroll idea.md')).not.toBeNull());
  });

  it('moves nothing on a drop with nothing lit, and nothing once the drag was cancelled', async () => {
    const { services } = await renderApp({ files: VAULT });
    const dataTransfer = transfer();
    fireEvent.click(within(tree()).getByText('Inbox'));
    const note = await within(tree()).findByText('Payroll idea');
    const people = within(tree()).getByText('People').closest('[role="treeitem"]') as Element;
    fireEvent.dragStart(note, { dataTransfer });
    fireEvent.drop(people, { dataTransfer });

    fireEvent.dragStart(note, { dataTransfer });
    fireEvent.dragOver(people, { dataTransfer });
    // Escape, or a release outside any target: the source hears dragend, no drop comes.
    fireEvent.dragEnd(note, { dataTransfer });
    expect(people).not.toHaveClass('is-drop-target');
    expect(screen.queryByTestId('tree-drag-tile')).toBeNull();
    fireEvent.drop(people, { dataTransfer });
    await act(() => Promise.resolve());
    expect(services.session.file('Inbox/Payroll idea.md')).not.toBeNull();
  });

  it('refuses a folder dropped into itself, and a folder that already holds the name', async () => {
    const { services } = await renderApp({
      files: { ...VAULT, 'People/Payroll idea.md': 'Another.\n' },
    });
    const dataTransfer = transfer();
    const people = within(tree()).getByText('People').closest('[role="treeitem"]') as Element;
    fireEvent.dragStart(people, { dataTransfer });
    const refused = fireEvent.dragOver(people, { dataTransfer });
    expect(refused).toBe(true);
    expect(people).not.toHaveClass('is-drop-target');
    fireEvent.dragEnd(people, { dataTransfer });

    fireEvent.click(within(tree()).getByText('Inbox'));
    const note = await within(tree()).findByText('Payroll idea');
    fireEvent.dragStart(note, { dataTransfer });
    expect(fireEvent.dragOver(people, { dataTransfer })).toBe(true);
    expect(people).not.toHaveClass('is-drop-target');
    fireEvent.drop(people, { dataTransfer });
    await act(() => Promise.resolve());
    expect(services.session.file('Inbox/Payroll idea.md')).not.toBeNull();
    expect(services.session.file('People/Payroll idea.md')).toHaveProperty('text', 'Another.\n');
  });
});

describe('the sidebar’s edge', () => {
  it('moves with the arrow keys, keeps the width on this device, and resets on a double click', async () => {
    const user = userEvent.setup();
    const { services } = await renderApp({ files: VAULT });
    const edge = screen.getByRole('separator', { name: 'Resize the sidebar' });
    edge.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(edge).toHaveAttribute('aria-valuenow', '288');
    expect(services.settings.load().ui.sidebarWidth).toBe(288);
    expect(document.querySelector('.app')).toHaveStyle('--sidebar-width: 288px');
    await user.keyboard('{End}');
    expect(edge).toHaveAttribute('aria-valuenow', '480');
    await user.dblClick(edge);
    expect(services.settings.load().ui.sidebarWidth).toBeNull();
  });

  it('puts the sidebar away and back with the shortcut, remembered', async () => {
    const user = userEvent.setup();
    const { services } = await renderApp({ files: VAULT });
    await user.keyboard('{Control>}{Alt>}s{/Alt}{/Control}');
    expect(document.querySelector('.app')).toHaveAttribute('data-sidebar', 'collapsed');
    expect(services.settings.load().ui.sidebarCollapsed).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Show the sidebar' }));
    expect(document.querySelector('.app')).toHaveAttribute('data-sidebar', 'shown');
  });
});

describe('a drag that is not a tree row’s', () => {
  it('moves nothing, even after a row’s drag was cancelled without a dragend', async () => {
    const { services } = await renderApp({ files: VAULT });
    fireEvent.click(within(tree()).getByText('Inbox'));
    const note = await within(tree()).findByText('Payroll idea');
    const folder = within(tree()).getByText('People').closest('[role="treeitem"]') as Element;
    fireEvent.dragStart(note, { dataTransfer: transfer() });
    // A tab's drag, or a file from the Finder, carries no tree row.
    const tab = transfer();
    tab.setData('application/x-dfai-lite-tab', 'tab-1');
    fireEvent.dragOver(folder, { dataTransfer: tab });
    expect(folder).not.toHaveClass('is-drop-target');
    fireEvent.drop(folder, { dataTransfer: tab });
    await act(() => Promise.resolve());
    expect(services.session.file('Inbox/Payroll idea.md')).not.toBeNull();
  });
});

describe('moving a folder in the picker', () => {
  it('offers no new folder inside the folder being moved', async () => {
    const user = userEvent.setup();
    const { services } = await renderApp({ files: VAULT });
    fireEvent.contextMenu(within(tree()).getByText('People'));
    await user.click(screen.getByRole('menuitem', { name: 'Move to…' }));
    await user.keyboard('People/Archive');
    const picker = screen.getByRole('dialog', { name: 'Move to' });
    expect(within(picker).queryByRole('option', { name: /New folder/ })).toBeNull();
    await user.keyboard('{Enter}');
    expect((services.files as MemoryVaultFiles).folders()).not.toContain('People/Archive');
  });
});

describe('a favorite’s menu', () => {
  it('opens from the “…” on its row', async () => {
    const user = userEvent.setup();
    await renderApp({ files: VAULT });
    await user.click(screen.getByRole('button', { name: 'More for Larkspur Payroll' }));
    const menu = screen.getByRole('menu', { name: 'Note actions' });
    const item = within(menu).getByRole('menuitem', { name: 'Remove from favorites' });
    expect(item).toBeInTheDocument();
  });
});
