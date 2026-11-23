// The version is written in four places; this fails the moment they disagree.
// `pnpm version:bump` moves them together.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargoLock, cargoToml, packageJson, topChangelogVersion } from './version.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const text = (path: string) => readFile(join(ROOT, path), 'utf8');

describe('the app’s version', () => {
  it('Cargo.toml, Cargo.lock and the newest CHANGELOG.md section match package.json', async () => {
    const version = packageJson.read(await text('package.json'));
    expect(cargoToml.read(await text('src-tauri/Cargo.toml'))).toBe(version);
    expect(cargoLock.read(await text('src-tauri/Cargo.lock'))).toBe(version);
    expect(topChangelogVersion(await text('CHANGELOG.md'))).toBe(version);
  });

  it('Tauri reads it from package.json rather than keeping its own', async () => {
    const config = JSON.parse(await text('src-tauri/tauri.conf.json')) as { version?: unknown };
    expect(config.version).toBe('../package.json');
  });
});
