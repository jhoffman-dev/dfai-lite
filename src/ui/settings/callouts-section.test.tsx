import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CALLOUTS_PATH } from '../../application/index.ts';
import { renderApp } from '../testing/render-app.tsx';

/*
 * Settings → Callouts: the built-in types, and the vault's own, added,
 * edited and deleted through a form whose name is checked as it is typed
 * and whose preview follows it. Saved to the vault's callouts file.
 */

const DECISION =
  '{\n  "hidden": [],\n  "types": [\n    {\n      "name": "decision",\n      "color": "purple",\n      "icon": "flag"\n    }\n  ]\n}\n';

async function openCallouts(files: Record<string, string> = {}) {
  const app = await renderApp({
    files: { 'Projects/Plan.md': '> [!decision] Go\n> Friday.\n', ...files },
  });
  await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]!);
  const section = await screen.findByRole('region', { name: 'Callouts' });
  return { ...app, section };
}

describe('Settings → Callouts', () => {
  it('lists the built-ins, each with a preview and its [!name]', async () => {
    const { section } = await openCallouts();
    const builtIns = within(section).getByRole('list', { name: 'Built-in callout types' });
    expect(within(builtIns).getAllByRole('listitem')).toHaveLength(13);
    expect(builtIns).toHaveTextContent('[!warning]');
    expect(within(section).getByText('None yet.')).toBeInTheDocument();
  });

  it('adds a type, saying what is wrong with a name first, its preview following the form', async () => {
    const { section, services } = await openCallouts();
    await userEvent.click(within(section).getByRole('button', { name: 'Add a type' }));
    const form = within(section).getByRole('form', { name: 'New callout type' });
    const name = within(form).getByRole('textbox', { name: /Name/ });

    await userEvent.type(name, 'my type');
    expect(within(form).getByText(/no spaces or \]/)).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(name);
    await userEvent.type(name, 'Warning');
    expect(within(form).getByText('“Warning” is a built-in type.')).toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.type(name, 'risk');
    expect(within(form).getByText('Written in a note as > [!risk]')).toBeInTheDocument();

    await userEvent.click(within(form).getByRole('radio', { name: 'Red' }));
    await userEvent.click(within(form).getByRole('radio', { name: 'Flame' }));
    const preview = form.querySelector('.callout--preview');
    expect(preview).toHaveAttribute('data-hue', 'red');
    expect(preview).toHaveTextContent('Risk');

    await userEvent.click(within(form).getByRole('button', { name: 'Add type' }));
    await waitFor(() => expect(services.session.file(CALLOUTS_PATH)?.text).toContain('"risk"'));
    expect(services.session.file(CALLOUTS_PATH)?.text).toContain('"color": "red"');
    expect(within(section).getByRole('list', { name: 'Your callout types' })).toHaveTextContent(
      '[!risk]',
    );
    expect(within(section).queryByRole('form')).toBeNull();
  });

  it('edits a type, and refuses a name another type has', async () => {
    const { section, services } = await openCallouts({
      [CALLOUTS_PATH]: DECISION.replace(
        '  ]\n}',
        '  ,\n    {\n      "name": "idea",\n      "color": "yellow",\n      "icon": "lightbulb"\n    }\n  ]\n}',
      ),
    });
    await userEvent.click(within(section).getByRole('button', { name: 'Edit idea' }));
    const form = within(section).getByRole('form', { name: 'Edit idea' });
    const name = within(form).getByRole('textbox', { name: /Name/ });
    await userEvent.clear(name);
    await userEvent.type(name, 'DECISION');
    expect(within(form).getByText('There is already a type named “DECISION”.')).toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.type(name, 'thought');
    await userEvent.type(within(form).getByRole('textbox', { name: /Label/ }), 'Passing thought');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(services.session.calloutSettings.types.map((type) => type.name)).toEqual([
        'decision',
        'thought',
      ]),
    );
    expect(services.session.calloutSettings.types[1]?.label).toBe('Passing thought');
  });

  it('deletes a type after saying the notes using it are left as they are', async () => {
    const { section, services } = await openCallouts({ [CALLOUTS_PATH]: DECISION });
    await userEvent.click(within(section).getByRole('button', { name: 'Delete decision' }));
    const asking = within(section).getByRole('group', { name: 'Delete decision' });
    expect(asking).toHaveTextContent('1 note uses it. Those notes are left as they are');
    await userEvent.click(within(asking).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(services.session.calloutSettings.types).toEqual([]));
    expect(services.session.file('Projects/Plan.md')?.text).toBe('> [!decision] Go\n> Friday.\n');
  });

  it('hides a built-in from the menus with its switch', async () => {
    const { section, services } = await openCallouts();
    const toggle = within(section).getByRole('switch', { name: 'Offer Bug in menus' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    await waitFor(() => expect(services.session.calloutSettings.hidden).toEqual(['bug']));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('says when the file cannot be read, and replaces it only when asked', async () => {
    const { section, services } = await openCallouts({ [CALLOUTS_PATH]: '{ nope' });
    expect(within(section).getByRole('alert')).toHaveTextContent('is not valid JSON');
    expect(within(section).getByRole('button', { name: 'Add a type' })).toBeDisabled();
    expect(services.session.file(CALLOUTS_PATH)?.text).toBe('{ nope');
    await userEvent.click(
      within(section).getByRole('button', { name: 'Replace with an empty list' }),
    );
    await waitFor(() => expect(within(section).queryByRole('alert')).toBeNull());
    expect(within(section).getByRole('button', { name: 'Add a type' })).toBeEnabled();
  });
});
