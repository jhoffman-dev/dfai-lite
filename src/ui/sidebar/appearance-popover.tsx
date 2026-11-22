import { useEffect, useRef, type KeyboardEvent } from 'react';
import { isSingleEmoji } from '../../application/index.ts';
import type { AppearancePatch } from '../../domain/appearance/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { HUE_OPTIONS, ICON_OPTIONS } from '../pickers/picker-options.ts';
import { iconKey, useLook } from '../appearance/look-glyph.tsx';
import { HuePicker } from '../pickers/hue-picker.tsx';
import { IconPicker } from '../pickers/icon-picker.tsx';
import { useApp } from '../services.ts';

const WIDTH = 310;

/**
 * "Icon & color…": the hue swatches and the glyph grid for one folder or
 * note, at the row it was opened from. Each pick is saved as it is made;
 * Escape or a click elsewhere closes it.
 */
export function AppearancePopover({
  path,
  name,
  at,
  onClose,
}: {
  path: VaultPath;
  name: string;
  at: { readonly x: number; readonly y: number };
  onClose: () => void;
}) {
  const { actions } = useApp();
  const look = useLook(path);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', closeOutside, true);
    return () => window.removeEventListener('pointerdown', closeOutside, true);
  }, [onClose]);

  const save = (patch: AppearancePatch) =>
    void actions.setAppearance(path, patch).catch(actions.report);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      ref={box}
      className="appearance-popover"
      role="dialog"
      aria-label={`Icon and color for ${name}`}
      style={{
        left: Math.max(8, Math.min(at.x, window.innerWidth - WIDTH - 8)),
        top: Math.max(8, Math.min(at.y, window.innerHeight - 280)),
      }}
      onKeyDown={onKeyDown}
    >
      <HuePicker
        label="Color"
        value={look?.hue ?? null}
        options={HUE_OPTIONS}
        onChange={(color) => save({ color })}
      />
      <IconPicker
        label="Icon"
        value={iconKey(look) ?? null}
        options={ICON_OPTIONS}
        acceptsEmoji={isSingleEmoji}
        onChange={(icon) => save({ icon })}
      />
    </div>
  );
}
