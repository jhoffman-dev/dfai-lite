import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AboutSection } from './about-section.tsx';

const BUILD = { version: '3.4.5', commit: 'f00ba12' };

describe('Settings → About', () => {
  it('shows the version and the commit it was built from', () => {
    render(<AboutSection build={BUILD} copyText={() => Promise.resolve()} />);
    expect(screen.getByRole('region', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('DFAI Lite 3.4.5');
    expect(screen.getByTestId('about-commit')).toHaveTextContent('Built from f00ba12');
  });

  it('copies the name, version and commit in one line, and says so', async () => {
    const copied: string[] = [];
    render(
      <AboutSection
        build={BUILD}
        copyText={async (text) => {
          copied.push(text);
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copied).toEqual(['DFAI Lite 3.4.5 (f00ba12)']);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('says when the clipboard refused', async () => {
    render(<AboutSection build={BUILD} copyText={() => Promise.reject(new Error('denied'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Could not copy' })).toBeInTheDocument();
  });
});
