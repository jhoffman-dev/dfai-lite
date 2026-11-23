import { describe, expect, it } from 'vitest';
import {
  bumpVersion,
  cargoLock,
  cargoToml,
  nextVersion,
  packageJson,
  startChangelogSection,
  topChangelogVersion,
} from './version.ts';

const PACKAGE_JSON = `{
  "name": "dfai-lite",
  "version": "0.2.0",
  "dependencies": {
    "other": "1.0.0"
  }
}
`;

const CARGO_TOML = `[package]
name = "dfai-lite"
authors = ["Mara Quill"]
version = "0.2.0"

[dependencies]
tauri = { version = "~2.12.7", features = [] }
`;

const CARGO_LOCK = `[[package]]
name = "dep"
version = "9.9.9"

[[package]]
name = "dfai-lite"
version = "0.2.0"
dependencies = [
 "dep",
]
`;

const CHANGELOG = `# Changelog

What changed in DFAI Lite, newest first.

## 0.2.0 — 2026-11-22

- Notes, folders and favorites.
`;

describe('nextVersion', () => {
  it('bumps the part asked for and zeroes the ones after it', () => {
    expect(nextVersion('1.4.9', 'patch')).toBe('1.4.10');
    expect(nextVersion('1.4.9', 'minor')).toBe('1.5.0');
    expect(nextVersion('1.4.9', 'major')).toBe('2.0.0');
  });

  it('refuses a version that is not plain x.y.z', () => {
    expect(() => nextVersion('1.4', 'patch')).toThrow('not a plain x.y.z');
    expect(() => nextVersion('1.4.0-beta.1', 'patch')).toThrow('not a plain x.y.z');
  });
});

describe('reading and writing each file’s version', () => {
  it('package.json: the top-level version only, the rest byte for byte', () => {
    expect(packageJson.read(PACKAGE_JSON)).toBe('0.2.0');
    expect(packageJson.write(PACKAGE_JSON, '0.3.0')).toBe(
      PACKAGE_JSON.replace('"version": "0.2.0"', '"version": "0.3.0"'),
    );
  });

  it('Cargo.toml: the [package] version, not a dependency’s', () => {
    expect(cargoToml.read(CARGO_TOML)).toBe('0.2.0');
    const written = cargoToml.write(CARGO_TOML, '0.3.0');
    expect(written).toContain('version = "0.3.0"');
    expect(written).toContain('tauri = { version = "~2.12.7"');
  });

  it('Cargo.toml: a version after another table is not the package’s', () => {
    const late = '[package]\nname = "dfai-lite"\n\n[lib]\nversion = "1.0.0"\n';
    expect(() => cargoToml.read(late)).toThrow('No version found in Cargo.toml');
  });

  it('Cargo.lock: the dfai-lite entry, not another package’s', () => {
    expect(cargoLock.read(CARGO_LOCK)).toBe('0.2.0');
    const written = cargoLock.write(CARGO_LOCK, '0.3.0');
    expect(written).toContain('name = "dfai-lite"\nversion = "0.3.0"');
    expect(written).toContain('name = "dep"\nversion = "9.9.9"');
  });

  it('a file without the version says which file', () => {
    expect(() => packageJson.write('{}', '1.0.0')).toThrow('No version found in package.json');
    expect(() => cargoLock.read('')).toThrow('Cargo.lock (dfai-lite)');
  });
});

describe('the changelog', () => {
  it('names its newest section’s version, or null with none', () => {
    expect(topChangelogVersion(CHANGELOG)).toBe('0.2.0');
    expect(topChangelogVersion('# Changelog\n')).toBeNull();
  });

  it('starts a dated section above the newest, keeping the older ones', () => {
    const next = startChangelogSection(CHANGELOG, '0.3.0', '2026-12-01');
    expect(topChangelogVersion(next)).toBe('0.3.0');
    expect(next).toContain('## 0.3.0 — 2026-12-01\n\n- \n\n## 0.2.0 — 2026-11-22');
    expect(next.startsWith('# Changelog\n\nWhat changed')).toBe(true);
  });

  it('starts the first section of a changelog that has none', () => {
    expect(startChangelogSection('# Changelog\n', '0.1.0', '2026-11-01')).toBe(
      '# Changelog\n\n## 0.1.0 — 2026-11-01\n\n- \n\n',
    );
  });

  it('refuses a version it already has', () => {
    expect(() => startChangelogSection(CHANGELOG, '0.2.0', '2026-12-01')).toThrow(
      'already has a section for 0.2.0',
    );
  });
});

describe('bumpVersion', () => {
  it('moves every file to the same next version, dated as asked', () => {
    const files = {
      packageJson: PACKAGE_JSON,
      cargoToml: CARGO_TOML,
      cargoLock: CARGO_LOCK,
      changelog: CHANGELOG,
    };
    const bumped = bumpVersion(files, { part: 'minor', date: '2026-12-01' });
    expect(bumped.version).toBe('0.3.0');
    expect(packageJson.read(bumped.files.packageJson)).toBe('0.3.0');
    expect(cargoToml.read(bumped.files.cargoToml)).toBe('0.3.0');
    expect(cargoLock.read(bumped.files.cargoLock)).toBe('0.3.0');
    expect(bumped.files.changelog).toContain('## 0.3.0 — 2026-12-01');
  });
});
