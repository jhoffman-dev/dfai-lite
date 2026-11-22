import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import '../shell/dialog.css';
import { describeSyncStatus, syncStatusDetail } from '../sync/sync-chip.tsx';
import type { SyncControls } from '../sync/sync-status.ts';
import { AppearanceSection } from './appearance-section.tsx';
import type { DesktopControls, RemoteInfo } from './desktop-controls.ts';
import { acceleratorOf, shortcutLabel } from './hotkey.ts';
import './settings.css';

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
    <section className="settings__section" aria-label="Sync">
      <h3 className="settings__heading">Sync</h3>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label" role="status">
            {label}
            {reason === null ? '' : ` — ${reason}`}
          </span>
          {remote === 'loading' || remote === null ? null : (
            <span className="settings__status">
              {remote.url} · {remote.branch}
            </span>
          )}
        </span>
        <span className="settings__actions">
          {status.kind === 'needs-confirmation' ? (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => sync.confirmDeletions()}
            >
              Sync the deletions
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--secondary"
            disabled={status.kind === 'syncing'}
            onClick={() => sync.syncNow()}
          >
            Sync now
          </button>
        </span>
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
    <section className="settings__section" aria-labelledby="hotkey-heading">
      <h3 id="hotkey-heading" className="settings__heading">
        Quick capture from anywhere
      </h3>
      <label className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">New note from anywhere</span>
          <span id="hotkey-hint" className="settings__status">
            Click the box and press the keys. Works while the app is open, even behind other
            windows.
          </span>
        </span>
        <span className="settings__actions">
          <input
            className="field settings__key"
            readOnly
            value={shortcutLabel(saved)}
            aria-describedby="hotkey-hint"
            onKeyDown={record}
          />
          {saved === '' ? null : (
            <button type="button" className="btn btn--ghost" onClick={() => apply('')}>
              Turn off
            </button>
          )}
        </span>
      </label>
      {problem === null ? null : (
        <p className="settings__problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

function VaultSection({ desktop }: { desktop: DesktopControls }) {
  const { actions } = useApp();
  return (
    <section className="settings__section" aria-label="Notes folder">
      <h3 className="settings__heading">Notes folder</h3>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">{desktop.vaultPath}</span>
        </span>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => desktop.changeVault().catch(actions.report)}
        >
          Change…
        </button>
      </div>
    </section>
  );
}

/**
 * Settings, as DFAI's: a 44px head with the title and its Close, then the
 * sections as hairline groups under a 15/600 title. Appearance, then the
 * notes folder, sync and the capture key; in a browser, only what it is.
 */
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { services, theme } = useApp();
  const { desktop, sync } = services;
  return (
    <div
      className="dialog-scrim"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="dialog settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <header className="settings__header">
          <h2 id="settings-title" className="settings__title">
            Settings
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close settings"
            autoFocus
            onClick={onClose}
          >
            <Icon name="close" size={15} />
          </button>
        </header>
        <div className="settings__body">
          <AppearanceSection theme={theme} />
          {desktop === null ? (
            <section className="settings__section" aria-label="Notes folder">
              <h3 className="settings__heading">Notes folder</h3>
              <p className="settings__lede">
                This is the sample vault, in memory. The Mac app opens your own folder of notes and
                syncs it with git.
              </p>
            </section>
          ) : (
            <>
              <VaultSection desktop={desktop} />
              {sync === null ? null : <SyncSection sync={sync} desktop={desktop} />}
              <HotkeySection desktop={desktop} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
