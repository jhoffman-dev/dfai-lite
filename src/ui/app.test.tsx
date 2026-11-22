import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { plainMarkdown } from '../application/testing/index.ts';
import { giveElementsASize, renderApp } from './testing/render-app.tsx';

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

beforeAll(giveElementsASize);
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('the sidebar', () => {
  it('shows the favorites above the folder tree', async () => {
    await renderApp();
    const favorites = screen.getByRole('list', { name: 'Favorites' });
    const tree = screen.getByRole('tree', { name: 'Notes' });
    expect(within(favorites).getByText('Larkspur Payroll')).toBeInTheDocument();
    expect(favorites.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(tree).getByText('Projects')).toBeInTheDocument();
  });

  it('adds the open note to the favorites with its star, and takes it off again', async () => {
    const user = userEvent.setup();
    await renderApp();
    await go('#/note/Welcome.md');
    await user.click(await screen.findByRole('button', { name: 'Add to favorites' }));
    const favorites = screen.getByRole('list', { name: 'Favorites' });
    expect(await within(favorites).findByText('Welcome')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove from favorites' }));
    await waitFor(() => expect(within(favorites).queryByText('Welcome')).toBeNull());
  });

  it('opens a folder, and its notes, from the tree', async () => {
    const user = userEvent.setup();
    await renderApp();
    const tree = screen.getByRole('tree', { name: 'Notes' });
    expect(within(tree).queryByText('Mara Quill')).toBeNull();
    await user.click(within(tree).getByText('People'));
    expect(await within(tree).findByText('Mara Quill')).toBeInTheDocument();
  });
});

describe('a note whose editor cannot load', () => {
  it('shows its text and a way to try again, and the rest of the window keeps working', async () => {
    const failed = Promise.reject(new Error('chunk failed to load'));
    failed.catch(() => undefined);
    let current: Promise<typeof plainMarkdown> = failed;
    await renderApp({
      loadMarkdown: ({ afresh = false } = {}) => {
        if (afresh) current = Promise.resolve(plainMarkdown);
        return current;
      },
    });
    await go('#/note/Welcome.md');
    expect(await screen.findByRole('alert')).toHaveTextContent('chunk failed to load');
    expect(screen.getByRole('tree', { name: 'Notes' })).toBeInTheDocument();
    // Clicked inside an awaited act, so React hears the fresh load land.
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    expect(await screen.findByRole('textbox', { name: 'Note markdown' })).toHaveValue(
      'Hello. #help\n',
    );
  });
});

describe('the tags view', () => {
  it('lists the notes carrying a tag, nested tags included', async () => {
    await renderApp();
    await go('#/tags/project');
    const list = await screen.findByRole('list', { name: 'Notes tagged project' });
    const titles = within(list)
      .getAllByRole('link')
      .map((link) => link.querySelector('.tags__note-title')?.textContent);
    expect(titles).toEqual(['Garden shed', 'Larkspur Payroll']);
    expect(
      within(screen.getByRole('navigation', { name: 'Tags' })).getByText('person'),
    ).toBeInTheDocument();
  });
});

describe('the search palette', () => {
  it('opens on ⌘K and opens the note chosen', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), 'garden');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Garden shed');
    expect(options.at(-1)).toHaveTextContent('Create note “garden”');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.location.hash).toBe('#/note/Projects%2FGarden%20shed.md'));
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('finds a note by its text and shows the hit', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), 'operations');
    const hit = screen.getAllByRole('option')[0];
    expect(hit).toHaveTextContent('Mara Quill');
    expect(hit?.querySelector('mark')).toHaveTextContent('operations');
  });

  it('switches the theme when asked for it by name', async () => {
    const user = userEvent.setup();
    await renderApp();
    expect(document.documentElement.dataset['theme']).toBe('light');
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), 'dark');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Switch to dark theme');
    await user.keyboard('{Enter}');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    // ⌘⇧L switches back, from anywhere.
    await user.keyboard('{Control>}{Shift>}L{/Shift}{/Control}');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});
