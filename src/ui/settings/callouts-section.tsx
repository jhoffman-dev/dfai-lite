import { useState, type ReactNode } from 'react';
import {
  BUILT_IN_CALLOUTS,
  CALLOUTS_PATH,
  deleteCalloutType,
  notesUsingCalloutType,
  replaceUnreadableCallouts,
  resolveCallout,
  saveCalloutType,
  setBuiltInCalloutHidden,
} from '../../application/index.ts';
import type { CalloutSettings, CalloutType } from '../../domain/callouts/index.ts';
import { useApp } from '../services.ts';
import { useVault } from '../state/vault-store.ts';
import { CalloutPreview, CalloutTypeForm } from './callout-type-form.tsx';

/** What the form is open for: nothing, a new type, or the type of this name. */
type Editing =
  null | { readonly kind: 'new' } | { readonly kind: 'edit'; readonly type: CalloutType };

const labelOf = (type: CalloutType, settings: CalloutSettings) =>
  resolveCallout(type.name, settings).label;

/** One type in the list: its preview, its `[!name]`, and what can be done to it. */
function TypeRow({
  type,
  settings,
  children,
}: {
  type: CalloutType;
  settings: CalloutSettings;
  children: ReactNode;
}) {
  return (
    <li className="callout-types__row">
      <CalloutPreview type={{ ...type, label: labelOf(type, settings) }} body="" />
      <code className="callout-types__name">[!{type.name}]</code>
      <span className="settings__actions">{children}</span>
    </li>
  );
}

/**
 * Settings → Callouts: the built-in types (each may be kept out of the
 * menus) and the vault's own, which can be added, edited and deleted. The
 * vault's are a file in the vault, so they sync to the other Mac and
 * Claude reads them; a file that cannot be read is said so, and written
 * over only when the person asks.
 */
export function CalloutsSection() {
  const { deps, actions } = useApp();
  const settings = useVault((vault) => vault.callouts);
  const problem = useVault((vault) => vault.calloutsProblem);
  const copies = useVault((vault) => vault.calloutCopies);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const hidden = new Set(settings.hidden);
  const locked = problem !== null;
  const run = (work: Promise<void>) => work.catch(actions.report);

  return (
    <section className="settings__section" aria-labelledby="callouts-heading">
      <h3 id="callouts-heading" className="settings__heading">
        Callouts
      </h3>
      <p className="settings__lede">
        A callout is written <code>&gt; [!type] Title</code>. Your own types are kept in the vault,
        in <code>{CALLOUTS_PATH}</code>, so your other Mac and Claude read them too.
      </p>
      {problem === null ? null : (
        <div className="settings__notice" role="alert">
          <span>
            {problem} Your types are not shown, and nothing is saved over the file until it is fixed
            or replaced.
          </span>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => run(replaceUnreadableCallouts(deps))}
          >
            Replace with an empty list
          </button>
        </div>
      )}
      {copies.length === 0 ? null : (
        <p className="settings__status" role="status">
          Types from another Mac’s copy ({copies.join(', ')}) are included. Your next change here
          merges them into {CALLOUTS_PATH} and moves the copy to the Trash.
        </p>
      )}

      <h4 className="settings__subheading">Your types</h4>
      {settings.types.length === 0 ? (
        <p className="settings__status">None yet.</p>
      ) : (
        <ul className="callout-types" aria-label="Your callout types">
          {settings.types.map((type) =>
            deleting === type.name ? (
              <DeleteRow
                key={type.name}
                type={type}
                usedIn={notesUsingCalloutType(deps, type.name).length}
                onDelete={() => {
                  setDeleting(null);
                  void run(deleteCalloutType(deps, { name: type.name }));
                }}
                onKeep={() => setDeleting(null)}
              />
            ) : (
              <TypeRow key={type.name} type={type} settings={settings}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-label={`Edit ${type.name}`}
                  disabled={locked}
                  onClick={() => setEditing({ kind: 'edit', type })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-label={`Delete ${type.name}`}
                  disabled={locked}
                  onClick={() => setDeleting(type.name)}
                >
                  Delete
                </button>
              </TypeRow>
            ),
          )}
        </ul>
      )}
      {editing === null ? (
        <div>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={locked}
            onClick={() => setEditing({ kind: 'new' })}
          >
            Add a type
          </button>
        </div>
      ) : (
        <CalloutTypeForm
          key={editing.kind === 'edit' ? editing.type.name : 'new'}
          editing={editing.kind === 'edit' ? editing.type : null}
          settings={settings}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            const replacing = editing.kind === 'edit' ? editing.type.name : null;
            try {
              const result = await saveCalloutType(deps, { draft, replacing });
              if (result.kind === 'invalid') return result.problems;
              setEditing(null);
              return null;
            } catch (error) {
              actions.report(error);
              return null;
            }
          }}
        />
      )}

      <h4 className="settings__subheading">Built-in</h4>
      <ul className="callout-types" aria-label="Built-in callout types">
        {BUILT_IN_CALLOUTS.map((type) => (
          <TypeRow key={type.name} type={type} settings={settings}>
            <span className="settings__status">
              {hidden.has(type.name) ? 'Hidden' : 'In menus'}
            </span>
            <button
              type="button"
              role="switch"
              className="toggle"
              aria-checked={!hidden.has(type.name)}
              aria-label={`Offer ${type.label ?? type.name} in menus`}
              disabled={locked}
              onClick={() =>
                run(
                  setBuiltInCalloutHidden(deps, {
                    name: type.name,
                    hidden: !hidden.has(type.name),
                  }),
                )
              }
            >
              <span className="toggle__knob" />
            </button>
          </TypeRow>
        ))}
      </ul>
    </section>
  );
}

/** A delete, asked about in its row: what it leaves behind, and the way back. */
function DeleteRow({
  type,
  usedIn,
  onDelete,
  onKeep,
}: {
  type: CalloutType;
  usedIn: number;
  onDelete: () => void;
  onKeep: () => void;
}) {
  const notes = usedIn === 1 ? '1 note uses it' : `${usedIn} notes use it`;
  return (
    <li
      className="callout-types__row callout-types__row--asking"
      role="group"
      aria-label={`Delete ${type.name}`}
    >
      <span className="settings__row-text">
        <span className="settings__row-label">Delete “{type.name}”?</span>
        <span className="settings__status" role="status">
          {usedIn === 0
            ? 'No note uses it.'
            : `${notes}. Those notes are left as they are: their callouts keep [!${type.name}] and show in plain gray.`}
        </span>
      </span>
      <span className="settings__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onKeep}>
          Keep
        </button>
        <button type="button" className="btn btn--destructive btn--sm" onClick={onDelete}>
          Delete
        </button>
      </span>
    </li>
  );
}
