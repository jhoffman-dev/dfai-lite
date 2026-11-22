import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { activate, closeTab, initialLayout, openView, type Layout } from '../panes/layout.ts';
import { TabBar } from './tab-bar.tsx';

const NOTES = ['Projects/Larkspur Payroll.md', 'People/Mara Quill.md', 'Welcome.md'];

function threeTabs(): Layout {
  return NOTES.reduce(
    (layout, path) =>
      openView(layout, {
        view: { kind: 'note', path },
        openIn: 'new-tab',
        preview: false,
        canSplit: true,
      }),
    initialLayout(),
  );
}

/** The tab bar on a real layout, the way a pane wires it. */
function Harness() {
  const [layout, setLayout] = useState(() => activate(threeTabs(), 't1'));
  const pane = layout.panes[0];
  if (pane === undefined) return null;
  return (
    <TabBar
      pane={pane}
      paneIndex={0}
      onActivate={(id) => setLayout((current) => activate(current, id))}
      onClose={(id) => setLayout((current) => closeTab(current, id))}
      onMenu={() => undefined}
      onMove={() => undefined}
    />
  );
}

const selected = () => screen.getByRole('tab', { selected: true });

describe('the tab bar', () => {
  it('is a tablist where only the selected tab is in the tab order', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Larkspur Payroll',
      'Mara Quill',
      'Welcome',
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0]).toHaveAttribute('aria-controls', 'tab-panel-0');
  });

  it('moves between tabs with the arrow keys, wrapping, and shows each one', async () => {
    render(<Harness />);
    selected().focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(selected()).toHaveTextContent('Mara Quill');
    expect(selected()).toHaveFocus();
    expect(selected().tabIndex).toBe(0);
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(selected()).toHaveTextContent('Welcome');
  });

  it('goes to the first and last tab with Home and End', async () => {
    render(<Harness />);
    selected().focus();
    await userEvent.keyboard('{End}');
    expect(selected()).toHaveTextContent('Welcome');
    await userEvent.keyboard('{Home}');
    expect(selected()).toHaveTextContent('Larkspur Payroll');
  });

  it('closes a tab with Delete, its close button, or a middle click', async () => {
    render(<Harness />);
    selected().focus();
    await userEvent.keyboard('{Delete}');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(selected()).toHaveTextContent('Mara Quill');
    await userEvent.click(screen.getByRole('button', { name: 'Close Welcome' }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    fireEvent(selected(), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(selected()).toHaveTextContent('New tab');
  });
});
