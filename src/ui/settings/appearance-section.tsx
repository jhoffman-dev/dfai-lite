import type { KeyboardEvent } from 'react';
import {
  THEME_CHOICES,
  type Theme,
  type ThemeChoice,
  type ThemeController,
} from '../theme/theme.ts';
import { useTheme } from '../theme/use-theme.ts';

const NAMED: Readonly<Record<ThemeChoice, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const THEME_NAMED: Readonly<Record<Theme, string>> = { light: 'Light', dark: 'Dark' };

/** What the row says under its label: the theme showing, and why. */
function statusOf(choice: ThemeChoice, theme: Theme): string {
  return choice === 'system'
    ? `${THEME_NAMED[theme]} now, as macOS is set.`
    : `${THEME_NAMED[theme]}, whatever macOS is set to.`;
}

/**
 * Settings → Appearance: System, Light or Dark, as DFAI's mode switch (a
 * segmented control). Applied at once and kept for this Mac; System follows
 * macOS as it changes. A radio group, so the arrows move the choice.
 */
export function AppearanceSection({ theme: controller }: { theme: ThemeController }) {
  const { choice, theme } = useTheme(controller);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const at = THEME_CHOICES.indexOf(choice);
    const next = THEME_CHOICES[(at + step + THEME_CHOICES.length) % THEME_CHOICES.length];
    if (next === undefined) return;
    controller.choose(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-choice='${next}']`)?.focus();
  };
  return (
    <section className="settings__section" aria-labelledby="appearance-heading">
      <h3 id="appearance-heading" className="settings__heading">
        Appearance
      </h3>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label" id="appearance-label">
            Theme
          </span>
          <span className="settings__status" data-testid="theme-status">
            {statusOf(choice, theme)}
          </span>
        </span>
        <div
          className="segmented"
          role="radiogroup"
          aria-labelledby="appearance-label"
          onKeyDown={onKeyDown}
        >
          {THEME_CHOICES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              data-choice={option}
              aria-checked={option === choice}
              tabIndex={option === choice ? 0 : -1}
              className={`segmented__option${option === choice ? ' segmented__option--on' : ''}`}
              onClick={() => controller.choose(option)}
            >
              {NAMED[option]}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
