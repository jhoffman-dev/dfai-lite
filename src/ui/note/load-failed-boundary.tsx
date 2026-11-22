import { Component, type ReactNode } from 'react';

interface Props {
  /** The note's text, shown as it is while the editor cannot load. */
  readonly text: string;
  /** Asks for the editor afresh, before it is drawn again. */
  readonly onRetry: () => void;
  readonly children: ReactNode;
}

/**
 * Catches the editor failing to load (its chunk dropped, the app updated
 * underneath) so the window keeps working: the note's text is shown as it
 * is, with a way to try again, which fetches the editor afresh.
 */
export class LoadFailedBoundary extends Component<Props, { failed: Error | null }> {
  override state: { failed: Error | null } = { failed: null };

  static getDerivedStateFromError(failed: Error) {
    return { failed };
  }

  override render() {
    const { failed } = this.state;
    if (failed === null) return this.props.children;
    return (
      <div className="note-load-failed">
        <p role="alert">
          The editor could not load ({failed.message}).{' '}
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              this.props.onRetry();
              this.setState({ failed: null });
            }}
          >
            Try again
          </button>
        </p>
        <pre className="note-editor-placeholder">{this.props.text}</pre>
      </div>
    );
  }
}
