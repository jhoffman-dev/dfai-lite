// pnpm version:bump <patch|minor|major>
//
// Moves package.json, src-tauri/Cargo.toml and the dfai-lite entry in
// src-tauri/Cargo.lock to the next version, and starts a dated CHANGELOG.md
// section for it. Write that section's lines before the PR goes up.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUMP_PARTS, bumpVersion, isBumpPart, type VersionFiles } from './version.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

const PATHS: Record<keyof VersionFiles, string> = {
  packageJson: join(ROOT, 'package.json'),
  cargoToml: join(ROOT, 'src-tauri/Cargo.toml'),
  cargoLock: join(ROOT, 'src-tauri/Cargo.lock'),
  changelog: join(ROOT, 'CHANGELOG.md'),
};

/** Today on this Mac, as the changelog dates a section: YYYY-MM-DD in local time. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function readAll(): Promise<VersionFiles> {
  const text = (key: keyof VersionFiles) => readFile(PATHS[key], 'utf8');
  const [packageJson, cargoToml, cargoLock, changelog] = await Promise.all([
    text('packageJson'),
    text('cargoToml'),
    text('cargoLock'),
    text('changelog'),
  ]);
  return { packageJson, cargoToml, cargoLock, changelog };
}

async function main(args: readonly string[]): Promise<number> {
  const part = args[0] ?? '';
  if (args.length !== 1 || !isBumpPart(part)) {
    console.error(`Usage: pnpm version:bump <${BUMP_PARTS.join('|')}>`);
    return 2;
  }
  const bumped = bumpVersion(await readAll(), { part, date: today() });
  await Promise.all(
    (Object.keys(PATHS) as (keyof VersionFiles)[]).map((key) =>
      writeFile(PATHS[key], bumped.files[key]),
    ),
  );
  console.log(`DFAI Lite is now ${bumped.version}. Write its lines in CHANGELOG.md.`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
