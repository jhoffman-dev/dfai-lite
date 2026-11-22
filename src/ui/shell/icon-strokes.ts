/** The glyphs' one stroke: 1.8 units on the 24-unit grid, in the text's color. */
export const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const;
export const round = { ...line, strokeLinecap: 'round' } as const;
export const joined = { ...line, strokeLinejoin: 'round' } as const;
