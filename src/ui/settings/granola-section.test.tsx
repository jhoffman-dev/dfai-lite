import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GranolaView } from '../../application/index.ts';
import { renderApp } from '../testing/render-app.tsx';
import { GranolaSettings } from './granola-section.tsx';

const VIEW: GranolaView = {
  keyState: 'set',
  keyProblem: null,
  pending: false,
  importing: false,
  waiting: false,
  automatic: true,
  lastImportAt: new Date('2026-11-20T17:05:00Z'),
  lastResult: 'Imported 2 meetings; 14 already here.',
  problems: [],
  problem: null,
  dismissed: 0,
  ledgerProblem: null,
};

function setUp(change: Partial<GranolaView> = {}) {
  const controls = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    importNow: vi.fn(),
    setAutomatic: vi.fn(),
    importDeletedAgain: vi.fn(),
    rebuildLedger: vi.fn(),
    startEmptyLedger: vi.fn(),
  };
  render(<GranolaSettings view={{ ...VIEW, ...change }} controls={controls} />);
  return controls;
}

describe('Settings → Granola', () => {
  it('with no key, says how to make one, and Import now waits for it', () => {
    setUp({ keyState: 'none', lastResult: null, lastImportAt: null });
    expect(screen.getByTestId('granola-key')).toHaveTextContent('No key on this Mac');
    expect(screen.getByText(/Settings → Connectors → API keys/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import now' })).toBeDisabled();
    expect(screen.getByTestId('granola-import')).toHaveTextContent('Not imported on this Mac yet');
    expect(screen.queryByRole('button', { name: 'Disconnect…' })).toBeNull();
  });

  it('hands the pasted key on once, and empties the field: nothing on the card holds it', async () => {
    const controls = setUp({ keyState: 'none' });
    const field = screen.getByLabelText('Granola API key');
    expect(field).toHaveAttribute('type', 'password');
    await userEvent.type(field, '  grn_Fict10nalKey ');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(controls.connect).toHaveBeenCalledWith('grn_Fict10nalKey');
    expect(field).toHaveValue('');
    expect(document.body.textContent).not.toContain('grn_Fict10nalKey');
  });

  it('connected, shows the last import and its time, and imports when asked', async () => {
    const controls = setUp();
    expect(screen.getByTestId('granola-key')).toHaveTextContent('Key set');
    expect(screen.getByTestId('granola-import')).toHaveTextContent(
      'Imported 2 meetings; 14 already here. (Nov 20, 2026',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import now' }));
    expect(controls.importNow).toHaveBeenCalledOnce();
  });

  it('while importing, or before the vault has synced, Import now waits', () => {
    setUp({ importing: true });
    expect(screen.getByTestId('granola-import')).toHaveTextContent('Importing from Granola…');
    expect(screen.getByRole('button', { name: 'Import now' })).toBeDisabled();
  });

  it('says the vault has to sync first', () => {
    setUp({ waiting: true });
    expect(screen.getByText(/once this vault has synced/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import now' })).toBeDisabled();
  });

  it('a refused key says to paste a new one; Import now still asks, as DFAI’s Sync now', () => {
    setUp({ keyState: 'refused', problem: 'Granola refused the API key.' });
    expect(screen.getByTestId('granola-key')).toHaveTextContent('Granola refused this key');
    expect(screen.getByRole('alert')).toHaveTextContent('Granola refused the API key.');
    expect(screen.getByRole('button', { name: 'Import now' })).toBeEnabled();
  });

  it('an import record that cannot be read stops imports and offers the two ways out', async () => {
    const controls = setUp({ ledgerProblem: '.dfai-lite/imports.json is not valid JSON.' });
    const choice = screen.getByRole('group', { name: 'The import record cannot be read' });
    expect(within(choice).getByRole('alert')).toHaveTextContent('is not valid JSON');
    expect(within(choice).getByText(/cannot be recovered/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import now' })).toBeDisabled();
    await userEvent.click(
      within(choice).getByRole('button', { name: 'Rebuild from the notes’ Source lines' }),
    );
    expect(controls.rebuildLedger).toHaveBeenCalledOnce();
    await userEvent.click(within(choice).getByRole('button', { name: 'Start an empty record' }));
    expect(controls.startEmptyLedger).toHaveBeenCalledOnce();
  });

  it('turns automatic import off and on', async () => {
    const controls = setUp();
    await userEvent.click(screen.getByRole('checkbox', { name: /Import automatically/ }));
    expect(controls.setAutomatic).toHaveBeenCalledWith(false);
  });

  it('lists the meetings it did not import, with why and where they are in Granola', () => {
    setUp({
      problems: [
        {
          id: 'not_Odd',
          title: 'Tobias 1:1',
          url: 'https://notes.granola.ai/d/odd',
          problem: 'Granola’s note could not be read: title: missing.',
        },
      ],
    });
    const list = screen.getByRole('list', { name: 'Meetings not imported' });
    expect(within(list).getByText('Tobias 1:1')).toBeInTheDocument();
    expect(within(list).getByText('https://notes.granola.ai/d/odd')).toBeInTheDocument();
  });

  it('offers the deleted meetings back', async () => {
    const controls = setUp({ dismissed: 2 });
    await userEvent.click(
      screen.getByRole('button', { name: 'Import the 2 meetings you deleted again' }),
    );
    expect(controls.importDeletedAgain).toHaveBeenCalledOnce();
  });

  it('asks before disconnecting, and disconnects on yes', async () => {
    const controls = setUp();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect…' }));
    const question = screen.getByRole('group', { name: 'Disconnect Granola?' });
    expect(within(question).getByText(/Meetings already in the vault stay/)).toBeInTheDocument();
    expect(question).toHaveTextContent(
      'a vault moved to another folder needs its key pasted again',
    );
    await userEvent.click(within(question).getByRole('button', { name: 'Disconnect' }));
    expect(controls.disconnect).toHaveBeenCalledOnce();
  });

  it('in the browser build, says Granola needs the Mac app', async () => {
    await renderApp();
    const [settings] = screen.getAllByRole('button', { name: 'Settings' });
    if (settings === undefined) throw new Error('no Settings button');
    await userEvent.click(settings);
    const section = await screen.findByRole('region', { name: 'Granola' });
    expect(section).toHaveTextContent('needs the Mac app');
    expect(within(section).queryByLabelText('Granola API key')).toBeNull();
  });
});
