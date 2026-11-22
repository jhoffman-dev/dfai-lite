import { gridKeys, tabStopOf } from './grid-keys.ts';
import './pickers.css';

/** One color to offer: a `data-hue` name the theme's stylesheet maps to its pastel, and its name. */
export interface HueOption {
  readonly value: string;
  readonly label: string;
}

/**
 * A row of the theme's pastel swatches, "None" first unless `required`. Generic: it knows the
 * hues only by the `data-hue` names it is given, and says which was picked.
 */
export function HuePicker({
  value,
  onChange,
  options,
  label,
  noneLabel = 'None',
  required = false,
}: {
  /** The hue chosen now; null for none. */
  value: string | null;
  onChange: (value: string | null) => void;
  options: readonly HueOption[];
  /** The group's name, read out and shown as its heading. */
  label: string;
  noneLabel?: string;
  /** A hue must be picked: no "None" cell (a callout type always has one). */
  required?: boolean;
}) {
  const none = { value: null, label: noneLabel };
  const cells: readonly { value: string | null; label: string }[] = required
    ? options
    : [none, ...options];
  const anyChecked = cells.some((cell) => cell.value === value);
  return (
    <fieldset className="picker">
      <legend className="picker__label">{label}</legend>
      <div
        className="picker__grid picker__grid--hues"
        role="radiogroup"
        aria-label={label}
        onKeyDown={gridKeys(cells.length)}
      >
        {cells.map((cell, index) => {
          const checked = cell.value === value;
          return (
            <button
              key={cell.value ?? ''}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={cell.label}
              title={cell.label}
              tabIndex={tabStopOf(checked, index, anyChecked)}
              className={cell.value === null ? 'picker__swatch is-none' : 'picker__swatch'}
              data-hue={cell.value ?? undefined}
              onClick={() => onChange(cell.value)}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
