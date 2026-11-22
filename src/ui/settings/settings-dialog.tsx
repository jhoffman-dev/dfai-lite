import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { useApp } from '../services.ts';
import '../shell/dialog.css';
import { describeSyncStatus, syncStatusDetail } from '../sync/sync-chip.tsx';
import type { SyncControls } from '../sync/sync-status.ts';
import type { DesktopControls, RemoteInfo } from './desktop-controls.ts';
import { acceleratorOf, shortcutLabel } from './hotkey.ts';

/** Where sync stands, in words, with the reason it stopped or is off, and where it syncs to. */
function SyncSection({ sync, desktop }: { sync: SyncControls; desktop: DesktopControls }) {
  const status = useSyncExternalStore(sync.subscribe, sync.getStatus);
  const [remote, setRemote] = useState<RemoteInfo | null | 'loading'>('loading');
  useEffect(() => {
    let current = true;
    desktop
      .remote()
      .then((found) => current && setRemote(found))
      // Where it syncs is a nicety here; the status line already says what went wrong.
      .catch(() => current && setRemote(null));
    return () => {
      current = false;
    };
  }, [desktop, status.kind]);
  const { label } = describeSyncStatus(status);
  const reason =
    status.kind === 'needs-sign-in'
      ? 'git’s login was refused. Run `git fetch` in the vault folder in Terminal to sign in again.'
      : syncStatusDetail(status);
  return (
    <section className="dialog-field" aria-label="Sync">
      <span>Sync</span>
      <p className="dialog-hint" role="status">
        {label}
        {reason === null ? '' : ` — ${reason}`}
      </p>
      {remote === 'loading' || remote === null ? null : (
        <p className="dialog-hint">
          {remote.url} · {remote.branch}
        </p>
      )}
      <div className="dialog-actions">
        {status.kind === 'needs-confirmation' ? (
          <button type="button" className="quiet-button" onClick={() => sync.confirmDeletions()}>
            Sync the deletions
          </button>
        ) : null}
        <button
          type="button"
          className="quiet-button"
          disabled={status.kind === 'syncing'}
          onClick={() => sync.syncNow()}
        >
          Sync now
        </button>
      </div>
    </section>
  );
}

/** The global key that makes a new note from anywhere: press the keys to record them. */
function HotkeySection({ desktop }: { desktop: DesktopControls }) {
  const { services } = useApp();
  const [saved, setSaved] = useState(() => services.settings.load().captureHotkey);
  const [problem, setProblem] = useState<string | null>(null);
  const apply = (accelerator: string) => {
    desktop
      .setCaptureHotkey(accelerator)
      .then(() => {
        setSaved(accelerator);
        setProblem(null);
      })
      .catch((error: unknown) =>
        setProblem(
          `The Mac would not take that key: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  };
  const record = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab' || event.key === 'Escape') return;
    event.preventDefault();
    const accelerator = acceleratorOf(event);
    if (accelerator !== null) apply(accelerator);
  };
  return (
    <label className="dialog-field">
      <span>New note from anywhere</span>
      <input
        className="text-input"
        readOnly
        value={shortcutLabel(saved)}
        aria-describedby="hotkey-hint"
        onKeyDown={record}
      />
      <p id="hotkey-hint" className="dialog-hint">
        Click the box and press the keys. Works while the app is open, even behind other windows.{' '}
        {saved === '' ? null : (
          <button type="button" className="quiet-button" onClick={() => apply('')}>
            Turn off
          </button>
        )}
      </p>
      {problem === null ? null : (
        <p className="dialog-hint" role="alert">
          {problem}
        </p>
      )}
    </label>
  );
}

function VaultSection({ desktop }: { desktop: DesktopControls }) {
  const { actions } = useApp();
  return (
    <section className="dialog-field" aria-label="Notes folder">
      <span>Notes folder</span>
      <p className="dialog-hint">{desktop.vaultPath}</p>
      <div className="dialog-actions">
        <button
          type="button"
          className="quiet-button"
          onClick={() => desktop.changeVault().catch(actions.report)}
        >
          Change…
        </button>
      </div>
    </section>
  );
}

/** Settings: the notes folder, sync, and the capture key. In a browser, only what it is. */
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { services } = useApp();
  const { desktop, sync } = services;
  return (
    <div
      className="dialog-scrim"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <h2 id="settings-title" className="dialog-title">
          Settings
        </h2>
        {desktop === null ? (
          <p className="dialog-hint">
            This is the sample vault, in memory. The Mac app opens your own folder of notes and
            syncs it with git.
          </p>
        ) : (
          <>
            <VaultSection desktop={desktop} />
            {sync === null ? null : <SyncSection sync={sync} desktop={desktop} />}
            <HotkeySection desktop={desktop} />
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="primary-button" autoFocus onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
