import { memo } from 'react';
import { GLYPHS, paintOf, type IconName } from './glyphs.ts';

export type { IconName } from './glyphs.ts';

/**
 * One glyph, 17px unless asked otherwise, as DFAI's. `filled` fills the
 * outline in its own color: a star that is on.
 */
export const Icon = memo(function Icon({
  name,
  size = 17,
  filled = false,
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg
      className={filled ? 'icon icon--filled' : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name].map((shape, at) => {
        const Shape = shape.tag;
        return <Shape key={at} {...shape.attrs} {...paintOf(shape)} />;
      })}
    </svg>
  );
});
