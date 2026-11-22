import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `var(--name)` in the app's stylesheets (src/ui/**) names a custom
 * property that is set somewhere: in a stylesheet, or by a component
 * (`'--split'`, `setProperty('--sidebar-width', …)`). A name that resolves to
 * nothing draws as nothing, silently: this is how a file written against old
 * tokens shows up. Here rather than in src/, which may not read the disk.
 */

const UI = join(import.meta.dirname, '..', 'src', 'ui');

function filesUnder(folder: string, test: (name: string) => boolean): string[] {
  return readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter(test)
    .map((name) => join(folder, name));
}

const stylesheets = filesUnder(UI, (name) => name.endsWith('.css'));
const sources = filesUnder(UI, (name) => /\.tsx?$/.test(name) && !name.includes('.test.'));
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The names set anywhere, and each stylesheet's uses with no fallback. */
export function unsetCustomProperties(
  sheets: ReadonlyMap<string, string>,
  code: readonly string[],
): string[] {
  const defined = new Set<string>();
  for (const css of sheets.values()) {
    for (const match of withoutComments(css).matchAll(/(--[\w-]+)\s*:/g)) {
      defined.add(match[1] as string);
    }
  }
  for (const source of code) {
    for (const match of source.matchAll(/['"`](--[\w-]+)['"`]/g)) defined.add(match[1] as string);
  }
  const unset: string[] = [];
  for (const [file, css] of sheets) {
    // A use with a fallback (`var(--x, 0px)`) may be unset on purpose.
    for (const match of withoutComments(css).matchAll(/var\((--[\w-]+)\s*\)/g)) {
      if (!defined.has(match[1] as string)) unset.push(`${file}: ${match[1]}`);
    }
  }
  return unset;
}

describe('the stylesheets', () => {
  it('read no custom property that nothing sets', () => {
    const sheets = new Map(
      stylesheets.map((file) => [relative(UI, file), readFileSync(file, 'utf8')] as const),
    );
    expect(sheets.size).toBeGreaterThan(15);
    expect(sheets.get(join('styles', 'tokens.css'))?.length ?? 0).toBeGreaterThan(1000);
    const code = sources.map((file) => readFileSync(file, 'utf8'));
    expect(unsetCustomProperties(sheets, code)).toEqual([]);
  });

  it('catches a name nothing sets, and lets a fallback or an inline one pass', () => {
    const sheets = new Map([
      ['a.css', ':root { --ink: #000; } .x { color: var(--ink); width: var(--split); }'],
      ['b.css', '.y { color: var(--gone); margin: var(--maybe, 0); }'],
    ]);
    expect(unsetCustomProperties(sheets, ["style={{ '--split': 1 }}"])).toEqual(['b.css: --gone']);
  });
});
