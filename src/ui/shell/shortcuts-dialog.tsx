import { useMemo } from 'react';
import { IS_MAC, shortcutList } from './shortcuts.ts';
import './dialog.css';

/**
 * Every keyboard shortcut, read straight from the `SHORTCUTS` table so the
 * list cannot drift from the keys. Escape, the close button or a click
 * outside closes it.
 */
export function ShortcutsDialog({ onClose, mac = IS_MAC }: { onClose: () => void; mac?: boolean }) {
  const entries = useMemo(() => shortcutList(mac), [mac]);
  return (
    <div
      className="dialog-scrim"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <div
        className="dialog shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <h2 className="dialog-title" id="shortcuts-title">
          Keyboard shortcuts
        </h2>
        <dl className="shortcuts-list">
          {entries.map((entry) => (
            <div key={entry.command} className="shortcuts-row">
              <dt>{entry.title}</dt>
              <dd>
                {entry.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <div className="dialog-actions">
          <button type="button" className="quiet-button" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
