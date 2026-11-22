/**
 * The app's version, kept in step across the files that carry it:
 * `package.json` is the source (Tauri reads it too), and `Cargo.toml`, the
 * `dfai-lite` entry in `Cargo.lock` and the top `CHANGELOG.md` section must
 * say the same. Pure text in, text out; the CLI in `version-bump.ts` does the
 * reading, the writing and the date.
 */

export type BumpPart = 'patch' | 'minor' | 'major';

export const BUMP_PARTS: readonly BumpPart[] = ['patch', 'minor', 'major'];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function isBumpPart(value: string): value is BumpPart {
  return (BUMP_PARTS as readonly string[]).includes(value);
}

/** The next version: a patch bumps the last number; minor and major zero the ones after them. */
export function nextVersion(current: string, part: BumpPart): string {
  const match = SEMVER.exec(current);
  if (match === null) throw new Error(`"${current}" is not a plain x.y.z version.`);
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** `package.json`'s top-level version (the first `"version"` key, as npm writes it). */
const PACKAGE_VERSION = /^(\s*"version":\s*")([^"]*)(")/m;
/** The `version` line of `Cargo.toml`'s `[package]` table: no line before it opens another table. */
const CARGO_TOML_VERSION = /(^\[package\]\n(?:(?!\[)[^\n]*\n)*?version\s*=\s*")([^"]*)(")/m;
/** The `dfai-lite` package's entry in `Cargo.lock`. */
const CARGO_LOCK_VERSION = /(\[\[package\]\]\nname = "dfai-lite"\nversion = ")([^"]*)(")/;
/** A changelog section heading: `## 0.2.0 — 2026-11-22`. */
const CHANGELOG_HEADING = /^## (\d+\.\d+\.\d+)\b.*$/m;

function read(text: string, pattern: RegExp, where: string): string {
  const match = pattern.exec(text);
  if (match?.[2] === undefined) throw new Error(`No version found in ${where}.`);
  return match[2];
}

function write(text: string, pattern: RegExp, where: string, version: string): string {
  read(text, pattern, where);
  return text.replace(pattern, (_whole, before: string, _old: string, after: string) => {
    return `${before}${version}${after}`;
  });
}

export const packageJson = {
  read: (text: string) => read(text, PACKAGE_VERSION, 'package.json'),
  write: (text: string, version: string) => write(text, PACKAGE_VERSION, 'package.json', version),
};

export const cargoToml = {
  read: (text: string) => read(text, CARGO_TOML_VERSION, 'Cargo.toml [package]'),
  write: (text: string, version: string) =>
    write(text, CARGO_TOML_VERSION, 'Cargo.toml [package]', version),
};

export const cargoLock = {
  read: (text: string) => read(text, CARGO_LOCK_VERSION, 'Cargo.lock (dfai-lite)'),
  write: (text: string, version: string) =>
    write(text, CARGO_LOCK_VERSION, 'Cargo.lock (dfai-lite)', version),
};

/** The version of the changelog's first section, or null when it has none. */
export function topChangelogVersion(changelog: string): string | null {
  return CHANGELOG_HEADING.exec(changelog)?.[1] ?? null;
}

/**
 * Starts a section for `version` above the newest one, dated `date`
 * (YYYY-MM-DD), with one empty bullet to fill in. Refuses a version the
 * changelog already has.
 */
export function startChangelogSection(changelog: string, version: string, date: string): string {
  if (new RegExp(`^## ${version.replaceAll('.', '\\.')}\\b`, 'm').test(changelog)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  }
  const section = `## ${version} — ${date}\n\n- \n\n`;
  const first = CHANGELOG_HEADING.exec(changelog);
  if (first === null) return `${changelog.trimEnd()}\n\n${section}`;
  return changelog.slice(0, first.index) + section + changelog.slice(first.index);
}

export interface VersionFiles {
  readonly packageJson: string;
  readonly cargoToml: string;
  readonly cargoLock: string;
  readonly changelog: string;
}

/** Every file moved to the next version, and the version it moved to. */
export function bumpVersion(
  files: VersionFiles,
  options: { part: BumpPart; date: string },
): { version: string; files: VersionFiles } {
  const version = nextVersion(packageJson.read(files.packageJson), options.part);
  return {
    version,
    files: {
      packageJson: packageJson.write(files.packageJson, version),
      cargoToml: cargoToml.write(files.cargoToml, version),
      cargoLock: cargoLock.write(files.cargoLock, version),
      changelog: startChangelogSection(files.changelog, version, options.date),
    },
  };
}
