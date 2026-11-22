import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { useTheme } from './use-theme.ts';

/**
 * Light or dark, as DFAI's sun-or-moon button in the sidebar's foot. It
 * shows the theme it would switch to and is named for it — "Switch to dark
 * theme" while light is on — so a screen reader hears what pressing it does.
 * Following the system again is Settings → Appearance.
 */
export function ThemeSwitch() {
  const { theme: controller } = useApp();
  const { theme } = useTheme(controller);
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;
  return (
    <button
      type="button"
      className="icon-button sidebar-footer__theme"
      aria-label={label}
      title={label}
      onClick={() => controller.toggle()}
    >
      <Icon name={next === 'dark' ? 'moon' : 'sun'} size={15} />
    </button>
  );
}
