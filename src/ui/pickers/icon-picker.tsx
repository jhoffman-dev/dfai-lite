import { useState } from 'react';
import { Icon, type IconName } from '../shell/icons.tsx';
import { gridKeys, tabStopOf } from './grid-keys.ts';
import './pickers.css';

/** One glyph to offer: the value it stands for, its name, and the glyph drawn. */
export interface IconOption {
  readonly value: string;
  readonly label: string;
  readonly icon: IconName;
}

const COLUMNS = 9;

/**
 * A grid of glyphs, "Default" first unless `required`, and, when `acceptsEmoji` is given, a
 * field for one typed emoji. Generic: it says which value was picked, and
 * an emoji is passed on as its own text.
 */
export function IconPicker({
  value,
  onChange,
  options,
  label,
  defaultLabel = 'Default',
  acceptsEmoji,
  required = false,
}: {
  /** The value chosen now: an option's, an emoji's text, or null for the default. */
  value: string | null;
  onChange: (value: string | null) => void;
  options: readonly IconOption[];
  label: string;
  defaultLabel?: string;
  /** Whether typed text is one emoji; leave it out for no emoji field. */
  acceptsEmoji?: (text: string) => boolean;
  /** A glyph must be picked: no "Default" cell (a callout type always has one). */
  required?: boolean;
}) {
  const first = required ? 0 : 1;
  const anyChecked =
    (!required && value === null) || options.some((option) => option.value === value);
  return (
    <fieldset className="picker">
      <legend className="picker__label">{label}</legend>
      <div
        className="picker__grid picker__grid--icons"
        role="radiogroup"
        aria-label={label}
        onKeyDown={gridKeys(COLUMNS)}
      >
        {required ? null : (
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            aria-label={defaultLabel}
            title={defaultLabel}
            tabIndex={tabStopOf(value === null, 0, anyChecked)}
            className="picker__cell is-default"
            onClick={() => onChange(null)}
          >
            <span aria-hidden="true">∅</span>
          </button>
        )}
        {options.map((option, index) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option.label}
              title={option.label}
              tabIndex={tabStopOf(checked, index + first, anyChecked)}
              className="picker__cell"
              onClick={() => onChange(option.value)}
            >
              <Icon name={option.icon} size={17} />
            </button>
          );
        })}
      </div>
      {acceptsEmoji === undefined ? null : (
        <EmojiField value={anyChecked ? null : value} accepts={acceptsEmoji} onPick={onChange} />
      )}
    </fieldset>
  );
}

/** One emoji, typed or pasted: picked as soon as the field holds exactly one. */
function EmojiField({
  value,
  accepts,
  onPick,
}: {
  value: string | null;
  accepts: (text: string) => boolean;
  onPick: (value: string) => void;
}) {
  const [text, setText] = useState(value ?? '');
  const valid = text === '' || accepts(text.trim());
  return (
    <label className="picker__emoji">
      <span>Emoji</span>
      <input
        className="picker__emoji-input"
        value={text}
        aria-invalid={!valid}
        placeholder="🙂"
        onChange={(event) => {
          const typed = event.target.value;
          setText(typed);
          if (accepts(typed.trim())) onPick(typed.trim());
        }}
      />
    </label>
  );
}
