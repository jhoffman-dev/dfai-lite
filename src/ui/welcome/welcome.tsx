import { useState } from 'react';
import '../styles/index.css';
import './welcome.css';

/**
 * The first start on a Mac, before a notes folder is chosen (or when the
 * one chosen cannot be opened): one button, and how to bring notes from
 * GitHub first.
 */
export function Welcome({
  problem,
  onChoose,
}: {
  /** Why the folder chosen before could not be opened, or null. */
  problem: string | null;
  /** Asks for the folder and opens the app on it. */
  onChoose: () => Promise<void>;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const choose = () =>
    onChoose().catch((error: unknown) =>
      setFailure(error instanceof Error ? error.message : String(error)),
    );
  const shown = failure ?? problem;
  return (
    <main className="welcome">
      <h1 className="welcome-title">DFAI Lite</h1>
      <p>Your notes are a folder of markdown files on this Mac.</p>
      <button type="button" className="primary-button" autoFocus onClick={choose}>
        Choose your notes folder
      </button>
      <p className="welcome-hint">
        Notes in a GitHub repository? Clone it first, then choose its folder:{' '}
        <code>git clone https://github.com/you/notes.git ~/Notes</code>
      </p>
      {shown === null ? null : (
        <p className="welcome-hint" role="alert">
          {shown}
        </p>
      )}
    </main>
  );
}
