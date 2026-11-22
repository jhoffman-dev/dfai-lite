import type { ResolvedAppearance, ResolvedIcon } from '../../domain/appearance/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { Icon, type IconName } from '../shell/icons.tsx';
import { useVault } from '../state/vault-store.ts';
import { glyphOf } from '../pickers/picker-options.ts';
import './appearance.css';

/** A path's look as drawn, or null for the default: one map lookup. */
export function useLook(path: VaultPath | null): ResolvedAppearance | null {
  return useVault((vault) => (path === null ? null : (vault.appearances.get(path) ?? null)));
}

/**
 * The glyph a folder or a note shows outside the sidebar (a tab, the page
 * bar, search, the folder picker, the drag tile): its own icon or emoji in
 * place of `fallback`, tinted by its hue. The box is the sidebar's alone.
 */
export function LookGlyph({
  look,
  fallback,
  size = 15,
}: {
  look: ResolvedAppearance | null;
  fallback: IconName;
  size?: number;
}) {
  const icon = look?.icon ?? null;
  return (
    <span className="look-glyph" data-hue={look?.hue ?? undefined} data-look-icon={iconKey(look)}>
      {icon === null ? (
        <Icon name={fallback} size={size} />
      ) : (
        <CustomIcon icon={icon} size={size} />
      )}
    </span>
  );
}

/** The icon a folder or a note wears: a glyph of the set, or its emoji. */
export function CustomIcon({ icon, size = 15 }: { icon: ResolvedIcon; size?: number }) {
  return icon.kind === 'emoji' ? (
    <span className="look-emoji">{icon.text}</span>
  ) : (
    <Icon name={glyphOf(icon.name)} size={size} />
  );
}

/** What a test or a stylesheet reads to know which icon is drawn. */
export function iconKey(look: ResolvedAppearance | null): string | undefined {
  const icon = look?.icon ?? null;
  if (icon === null) return undefined;
  return icon.kind === 'glyph' ? icon.name : icon.text;
}
