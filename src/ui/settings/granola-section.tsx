import { useState, useSyncExternalStore, type FormEvent } from 'react';
import type {
  GranolaControls,
  GranolaKeyState,
  GranolaNoteProblem,
  GranolaView,
} from '../../application/index.ts';
import { useApp } from '../services.ts';
import './granola-section.css';

const KEY_STATUS: Readonly<Record<GranolaKeyState, string>> = {
  checking: 'Checking…',
  none: 'No key on this Mac',
  set: 'Key set',
  accepted: 'Key accepted',
  refused: 'Granola refused this key — paste a new one',
};

const AT = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function importStatus(view: GranolaView): string {
  if (view.importing) return 'Importing from Granola…';
  const at = view.lastImportAt === null ? '' : ` (${AT.format(view.lastImportAt)})`;
  if (view.lastResult !== null) return `${view.lastResult}${at}`;
  return 'Not imported on this Mac yet';
}

/**
 * Settings → Granola, as DFAI's card: the API key the app asks Granola with,
 * the last import, Import now, automatic import, and forgetting the key. The
 * key is typed into a masked field and handed on; the field is emptied as
 * it goes, and nothing here ever holds a key to show.
 */
export function GranolaSettings({
  view,
  controls,
}: {
  view: GranolaView;
  controls: Pick<
    GranolaControls,
    | 'connect'
    | 'disconnect'
    | 'importNow'
    | 'setAutomatic'
    | 'importDeletedAgain'
    | 'rebuildLedger'
    | 'startEmptyLedger'
  >;
}) {
  const hasKey = view.keyState !== 'none' && view.keyState !== 'checking';
  const usable = view.keyState === 'set' || view.keyState === 'accepted';
  // As DFAI's Sync now: asked whatever the key's last answer was, so a mended key is heard.
  const canImport = hasKey && view.ledgerProblem === null;
  return (
    <section className="settings__section" aria-labelledby="granola-heading">
      <h3 id="granola-heading" className="settings__heading">
        Granola
      </h3>
      <p className="settings__lede">
        Meetings you record in Granola land in Meetings, a folder for each month, as the app opens
        and every 15 minutes. The API key stays in this Mac’s Keychain, never in the vault.
      </p>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">API key</span>
          <span className="settings__status" data-testid="granola-key">
            {KEY_STATUS[view.keyState]}
          </span>
        </span>
        <button
          className="btn btn--secondary"
          type="button"
          disabled={!canImport || view.waiting || view.importing || view.pending}
          onClick={controls.importNow}
        >
          Import now
        </button>
      </div>
      {view.ledgerProblem !== null && (
        <LedgerProblem
          reason={view.ledgerProblem}
          busy={view.importing}
          onRebuild={controls.rebuildLedger}
          onStartEmpty={controls.startEmptyLedger}
        />
      )}
      {view.keyState === 'none' && (
        <p className="settings__lede">
          Make one in Granola → Settings → Connectors → API keys (it needs a Business or Enterprise
          plan), then paste it here. Granola shows it only once.
        </p>
      )}
      <KeyForm hasKey={hasKey} pending={view.pending} onSave={controls.connect} />
      {view.keyProblem !== null && (
        <p className="settings__problem" role="alert">
          {view.keyProblem}
        </p>
      )}
      {hasKey && view.waiting && (
        <p className="settings__lede">The app imports from Granola once this vault has synced.</p>
      )}
      <label className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Import automatically</span>
          <span className="settings__status">As the app opens, then every 15 minutes.</span>
        </span>
        <input
          type="checkbox"
          checked={view.automatic}
          onChange={(event) => controls.setAutomatic(event.target.checked)}
        />
      </label>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Last import</span>
          <span className="settings__status" data-testid="granola-import" role="status">
            {importStatus(view)}
          </span>
        </span>
      </div>
      {view.problems.length > 0 && <NotWritten problems={view.problems} />}
      {view.problem !== null && (
        <p className="settings__problem" role="alert">
          {view.problem}
        </p>
      )}
      {view.dismissed > 0 && usable && (
        <div className="settings__actions">
          <button
            className="btn btn--ghost"
            type="button"
            disabled={view.importing || view.waiting}
            onClick={controls.importDeletedAgain}
          >
            Import the {view.dismissed === 1 ? 'meeting' : `${view.dismissed} meetings`} you deleted
            again
          </button>
        </div>
      )}
      {hasKey && <ForgetKey pending={view.pending} onForget={controls.disconnect} />}
    </section>
  );
}

function KeyForm({
  hasKey,
  pending,
  onSave,
}: {
  hasKey: boolean;
  pending: boolean;
  onSave: (key: string) => Promise<void>;
}) {
  const [key, setKey] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave(key.trim());
    setKey('');
  };
  return (
    <form className="granola__form" aria-label="Set the Granola API key" onSubmit={submit}>
      <input
        className="field granola__field"
        type="password"
        aria-label="Granola API key"
        placeholder={hasKey ? 'Paste a new key to replace it' : 'grn_…'}
        autoComplete="off"
        spellCheck={false}
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <button className="btn btn--primary" type="submit" disabled={pending || key.trim() === ''}>
        Connect
      </button>
    </form>
  );
}

function NotWritten({ problems }: { problems: readonly GranolaNoteProblem[] }) {
  return (
    <details className="granola__details">
      <summary>Details</summary>
      <ul className="granola__notes" aria-label="Meetings not imported">
        {problems.map(({ id, title, problem, url }) => (
          <li key={`${id} ${problem}`} className="granola__note">
            <span className="settings__row-label">{title}</span>
            <span className="settings__status">{problem}</span>
            {url === null ? null : <span className="settings__status granola__url">{url}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The import record cannot be read: imports wait for one of two choices, said plainly. */
function LedgerProblem({
  reason,
  busy,
  onRebuild,
  onStartEmpty,
}: {
  reason: string;
  busy: boolean;
  onRebuild: () => void;
  onStartEmpty: () => void;
}) {
  return (
    <div className="granola__confirm" role="group" aria-label="The import record cannot be read">
      <p className="settings__problem" role="alert">
        The import record cannot be read: {reason} Nothing is imported until you choose.
      </p>
      <p className="settings__lede">
        Rebuilding links each Granola meeting again to the note whose Source line points at it, and
        imports now. Which meetings you had deleted cannot be recovered: they come back as notes.
        Starting an empty record does the same at the next import.
      </p>
      <div className="settings__actions">
        <button className="btn btn--primary" type="button" disabled={busy} onClick={onRebuild}>
          Rebuild from the notes’ Source lines
        </button>
        <button className="btn btn--ghost" type="button" disabled={busy} onClick={onStartEmpty}>
          Start an empty record
        </button>
      </div>
    </div>
  );
}

function ForgetKey({ pending, onForget }: { pending: boolean; onForget: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <div className="settings__actions">
        <button
          className="btn btn--ghost"
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          Disconnect…
        </button>
      </div>
    );
  }
  return (
    <div className="granola__confirm" role="group" aria-label="Disconnect Granola?">
      <p className="settings__lede">
        The app stops importing from Granola on this Mac and removes the key from its Keychain.
        Meetings already in the vault stay. Granola does not show a key again, so you would make a
        new one to connect again. The key is kept for this vault folder where it is now: a vault
        moved to another folder needs its key pasted again.
      </p>
      <div className="settings__actions">
        <button
          className="btn btn--primary"
          type="button"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            void onForget();
          }}
        >
          Disconnect
        </button>
        <button className="btn btn--ghost" type="button" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ConnectedSection({ granola }: { granola: GranolaControls }) {
  const view = useSyncExternalStore(granola.subscribe, granola.getView);
  return <GranolaSettings view={view} controls={granola} />;
}

/** Settings → Granola: the card in the Mac app; in a browser, that it needs the Mac app. */
export function GranolaSection() {
  const { services } = useApp();
  if (services.granola !== null) return <ConnectedSection granola={services.granola} />;
  return (
    <section className="settings__section" aria-labelledby="granola-heading">
      <h3 id="granola-heading" className="settings__heading">
        Granola
      </h3>
      <p className="settings__lede">
        Importing meetings from Granola needs the Mac app: it keeps the API key in the Mac’s
        Keychain and asks Granola from there.
      </p>
    </section>
  );
}
