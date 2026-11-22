import { useId, useState, type FormEvent } from 'react';
import { checkCalloutDraft } from '../../application/index.ts';
import type {
  CalloutDraft,
  CalloutDraftProblems,
  CalloutHue,
  CalloutIcon,
  CalloutSettings,
  CalloutType,
} from '../../domain/callouts/index.ts';
import { Icon } from '../shell/icons.tsx';
import '../shell/callout.css';
import { HuePicker } from '../pickers/hue-picker.tsx';
import { IconPicker } from '../pickers/icon-picker.tsx';
import { CALLOUT_ICON_OPTIONS, HUE_OPTIONS } from '../pickers/picker-options.ts';

const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** A callout as a note shows it: its type's badge and label (or a title), then a line of body. */
export function CalloutPreview({
  type,
  body = 'A callout of this type, as a note shows it.',
}: {
  type: Pick<CalloutType, 'hue' | 'icon'> & { readonly label: string };
  body?: string;
}) {
  return (
    <div className="callout callout--preview" data-hue={type.hue}>
      <div className="callout__title">
        <span className="callout__badge">
          <Icon name={type.icon} size={15} />
        </span>
        <span className="callout__label">{type.label}</span>
      </div>
      {body === '' ? null : (
        <div className="callout__body">
          <p>{body}</p>
        </div>
      )}
    </div>
  );
}

function draftOf(type: CalloutType | null): CalloutDraft {
  return type === null
    ? { name: '', label: '', hue: 'blue', icon: 'star' }
    : { name: type.name, label: type.label ?? '', hue: type.hue, icon: type.icon };
}

/**
 * Adds or edits one of the vault's callout types: its name (what goes in
 * `[!name]`), an optional label, a hue from DFAI's set and a glyph, with
 * a live preview. What is wrong with the name shows once it is typed; the
 * rules are the domain's, so the form only reports them.
 */
export function CalloutTypeForm({
  editing,
  settings,
  onSave,
  onCancel,
}: {
  /** The type edited, or null to add one. */
  editing: CalloutType | null;
  settings: CalloutSettings;
  /** Saves the draft; answers its problems when it could not be saved. */
  onSave: (draft: CalloutDraft) => Promise<CalloutDraftProblems | null>;
  onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(editing));
  const [shown, setShown] = useState<CalloutDraftProblems>({});
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const checked = checkCalloutDraft(draft, { settings, replacing: editing?.name ?? null });
  const live = checked.kind === 'invalid' ? checked.problems : {};
  const problems = touched ? { ...shown, ...live } : shown;
  const change = (part: Partial<CalloutDraft>) => {
    setDraft((now) => ({ ...now, ...part }));
    setShown({});
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (checked.kind === 'invalid') return setShown(checked.problems);
    setSaving(true);
    onSave(draft)
      .then((found) => found !== null && setShown(found))
      .finally(() => setSaving(false));
  };
  const name = draft.name.trim();
  const label = draft.label.trim() !== '' ? draft.label.trim() : capitalized(name.toLowerCase());
  return (
    <form
      className="callout-form"
      aria-label={editing === null ? 'New callout type' : `Edit ${editing.name}`}
      onSubmit={submit}
      noValidate
    >
      <div className="callout-form__fields">
        <label className="callout-form__field">
          <span className="callout-form__label">Name</span>
          <input
            className={`field${problems.name === undefined ? '' : ' field--invalid'}`}
            value={draft.name}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            aria-invalid={problems.name !== undefined}
            aria-describedby={`${id}-name`}
            placeholder="decision"
            onChange={(event) => {
              setTouched(true);
              change({ name: event.target.value });
            }}
          />
          <span
            id={`${id}-name`}
            className={problems.name === undefined ? 'settings__status' : 'settings__problem'}
          >
            {problems.name ?? `Written in a note as > [!${name === '' ? 'name' : name}]`}
          </span>
        </label>
        <label className="callout-form__field">
          <span className="callout-form__label">Label (optional)</span>
          <input
            className={`field${problems.label === undefined ? '' : ' field--invalid'}`}
            value={draft.label}
            placeholder={
              name === '' ? 'Shown when a callout has no title' : capitalized(name.toLowerCase())
            }
            onChange={(event) => change({ label: event.target.value })}
          />
          {problems.label === undefined ? null : (
            <span className="settings__problem">{problems.label}</span>
          )}
        </label>
      </div>
      <HuePicker
        label="Color"
        required
        options={HUE_OPTIONS}
        value={draft.hue}
        onChange={(hue) => hue !== null && change({ hue })}
      />
      <IconPicker
        label="Icon"
        required
        options={CALLOUT_ICON_OPTIONS}
        value={draft.icon}
        onChange={(icon) => icon !== null && change({ icon })}
      />
      <div className="callout-form__field">
        <span className="callout-form__label">Preview</span>
        <CalloutPreview
          type={{
            // Only the pickers set these, from the domain's own sets.
            hue: draft.hue as CalloutHue,
            icon: draft.icon as CalloutIcon,
            label: label === '' ? 'Name' : label,
          }}
        />
      </div>
      <div className="callout-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {editing === null ? 'Add type' : 'Save'}
        </button>
      </div>
    </form>
  );
}
