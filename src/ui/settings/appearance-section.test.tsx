import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../application/index.ts';
import { createThemeController, type Theme } from '../theme/theme.ts';
import { AppearanceSection } from './appearance-section.tsx';

function setUp(systemDark = false) {
  let settings: Settings = DEFAULT_SETTINGS;
  const shown: Theme[] = [];
  const controller = createThemeController({
    settings: { load: () => settings, save: (next) => (settings = next) },
    system: { isDark: () => systemDark, subscribe: () => () => undefined },
    root: { show: (theme) => shown.push(theme) },
    remember: () => undefined,
  });
  render(<AppearanceSection theme={controller} />);
  return { controller, shown, saved: () => settings.ui.theme };
}

describe('Settings → Appearance', () => {
  it('offers System, Light and Dark, with System chosen at first', () => {
    setUp();
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('theme-status')).toHaveTextContent('Light now, as macOS is set.');
  });

  it('applies a choice at once and keeps it', async () => {
    const user = userEvent.setup();
    const { shown, saved } = setUp();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(shown.at(-1)).toBe('dark');
    expect(saved()).toBe('dark');
    expect(screen.getByTestId('theme-status')).toHaveTextContent('Dark, whatever macOS is set to.');
  });

  it('moves the choice with the arrow keys, as a radio group does', async () => {
    const user = userEvent.setup();
    const { saved } = setUp(true);
    screen.getByRole('radio', { name: 'System' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(saved()).toBe('light');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(saved()).toBe('dark');
  });
});
