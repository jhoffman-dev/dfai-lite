import type { KeyboardEvent, ReactNode } from 'react';

/**
 * A grid of choices that is one radio group, as the theme switch is: one
 * stop on Tab, the arrows move the choice (and wrap), and each choice says
 * its name to a screen reader while it shows only a swatch or a glyph.
 */
export function ChoiceGrid<T extends string>({
  label,
  choices,
  value,
  onChange,
  nameOf,
  draw,
  className,
}: {
  label: string;
  choices: readonly T[];
  value: T | null;
  onChange: (choice: T) => void;
  nameOf: (choice: T) => string;
  draw: (choice: T) => ReactNode;
  className: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const at = value === null ? -1 : choices.indexOf(value);
    const next = choices[(at + step + choices.length) % choices.length];
    if (next === undefined) return;
    onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-choice='${next}']`)?.focus();
  };
  const focusable = value ?? choices[0];
  return (
    <div className={className} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          role="radio"
          data-choice={choice}
          aria-checked={choice === value}
          aria-label={nameOf(choice)}
          title={nameOf(choice)}
          tabIndex={choice === focusable ? 0 : -1}
          className="choice-grid__option"
          onClick={() => onChange(choice)}
        >
          {draw(choice)}
        </button>
      ))}
    </div>
  );
}
