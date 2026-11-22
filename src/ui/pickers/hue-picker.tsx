import { gridKeys, tabStopOf } from './grid-keys.ts';
import './pickers.css';

/** One color to offer: a `data-hue` name the theme's stylesheet maps to its pastel, and its name. */
export interface HueOption {
  readonly value: string;
  readonly label: string;
}

/**
 * A row of the theme's pastel swatches, "None" first. Generic: it knows the
 * hues only by the `data-hue` names it is given, and says which was picked.
 */
export function HuePicker({
  value,
  onChange,
  options,
  label,
  noneLabel = 'None',
}: {
  /** The hue chosen now; null for none. */
  value: string | null;
  onChange: (value: string | null) => void;
  options: readonly HueOption[];
  /** The group's name, read out and shown as its heading. */
  label: string;
  noneLabel?: string;
}) {
  const cells = [{ value: null, label: noneLabel }, ...options];
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
