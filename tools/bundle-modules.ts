// Bundles TypeScript modules from this repository into one script with no
// relative imports, for a place that cannot install anything: an n8n Code
// node, or a vault Claude searches. No bundler: Node strips the types, each
// module becomes a function scope, and the repository's Prettier formats the
// result. A Node built-in a module imports (`node:fs/promises`) is imported
// once at the top, so the script still runs on a bare Node.
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What to bundle, and how the script hands it out. */
export interface BundleSpec {
  /** The module whose names the script hands out (an `index.ts` is followed to its files). */
  readonly entry: string;
  /** The names handed out, as `<globalName>.<name>`. */
  readonly publicNames: readonly string[];
  /** The constant the bundle's names live on. */
  readonly globalName: string;
  /** Comment lines at the top: where it came from, and how to rebuild it. */
  readonly header: string;
  /** Where the script is written; Prettier formats it as that file. */
  readonly outPath: string;
  /** Code after the bundle, such as the call that runs it. */
  readonly footer?: string;
}

/** `import { a, type B } from './x.ts';`, over one line or several. */
const IMPORT = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)';$/gm;
/** `export { a, type B } from './x.ts';` in a module's index. */
const RE_EXPORT = /^export\s+\{([^}]*)\}\s+from\s+'([^']+)';$/gm;
/** A doc comment whose declaration was a type, which stripping left as blank lines. */
const ORPHAN_DOC = /^[ \t]*\/\*\*(?:(?!\*\/)[\s\S])*\*\/[ \t]*\n(?=[ \t]*\n)/gm;
const EXPORTED = /^export\s+((?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*))/gm;

const isBuiltin = (from: string): boolean => from.startsWith('node:');

/** The value names a `{ … }` list holds, its `type` names left out. */
const valueNames = (list: string) =>
  list
    .split(',')
    .map((each) => each.trim())
    .filter((each) => each !== '' && !each.startsWith('type '));

const sources = new Map<string, string>();
async function source(file: string): Promise<string> {
  const cached = sources.get(file);
  if (cached !== undefined) return cached;
  const text = await readFile(file, 'utf8');
  sources.set(file, text);
  return text;
}

/** The file that defines `name`, following a module's `index.ts` to the file it re-exports from. */
async function definingFile(file: string, name: string): Promise<string> {
  if (!file.endsWith('/index.ts')) return file;
  for (const [, list, from] of (await source(file)).matchAll(RE_EXPORT)) {
    if (valueNames(list ?? '').includes(name))
      return definingFile(join(dirname(file), from ?? ''), name);
  }
  throw new Error(`${relative(ROOT, file)} does not export ${name}`);
}

/** Each value a module imports, and the file (or Node built-in) that defines it. */
async function importsOf(file: string): Promise<{ name: string; from: string }[]> {
  const found: { name: string; from: string }[] = [];
  for (const [, typeOnly, list, from = ''] of (await source(file)).matchAll(IMPORT)) {
    if (typeOnly !== undefined) continue;
    if (isBuiltin(from)) {
      for (const name of valueNames(list ?? '')) found.push({ name, from });
      continue;
    }
    if (!from.startsWith('.')) throw new Error(`${relative(ROOT, file)} imports a package`);
    for (const name of valueNames(list ?? '')) {
      found.push({ name, from: await definingFile(join(dirname(file), from), name) });
    }
  }
  return found;
}

/** The modules the public names need, each after the ones it imports. */
async function moduleOrder(spec: BundleSpec): Promise<string[]> {
  const order: string[] = [];
  const visit = async (file: string): Promise<void> => {
    if (order.includes(file)) return;
    for (const { from } of await importsOf(file)) if (!isBuiltin(from)) await visit(from);
    order.push(file);
  };
  for (const name of spec.publicNames) await visit(await definingFile(spec.entry, name));
  return order;
}

/** `meeting-note.ts` → `meetingNoteModule`; `node:fs/promises` → `nodeFsPromisesModule`. */
function scopeName(file: string): string {
  const base = isBuiltin(file)
    ? file.replace(/[:/]/g, '-')
    : file.slice(file.lastIndexOf('/') + 1, -'.ts'.length);
  return `${base.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())}Module`;
}

/** One module as a function scope that returns its exports and reads its imports from earlier scopes. */
async function moduleScope(file: string): Promise<string> {
  const imports = await importsOf(file);
  let body = stripTypeScriptTypes(await source(file), { mode: 'strip' })
    .replace(IMPORT, '')
    .replace(ORPHAN_DOC, '');
  const exported = [...body.matchAll(EXPORTED)].map((match) => match[2] ?? '');
  body = body.replace(EXPORTED, '$1');
  const reads = [...new Set(imports.map(({ from }) => from))].map((from) => {
    const names = imports.filter((each) => each.from === from).map(({ name }) => name);
    return `const { ${names.join(', ')} } = ${scopeName(from)};`;
  });
  return [
    `// ${relative(ROOT, file)}`,
    `const ${scopeName(file)} = (() => {`,
    ...reads,
    body,
    `return { ${exported.join(', ')} };`,
    '})();',
  ].join('\n');
}

/** One `import * as` line per Node built-in the modules use, sorted. */
async function builtinImports(files: readonly string[]): Promise<string[]> {
  const builtins = new Set<string>();
  for (const file of files) {
    for (const { from } of await importsOf(file)) if (isBuiltin(from)) builtins.add(from);
  }
  return [...builtins].sort().map((from) => `import * as ${scopeName(from)} from '${from}';`);
}

/** `name: <scope>.name` for each public name, from the scope that defines it. */
async function publicReads(spec: BundleSpec, files: readonly string[]): Promise<string> {
  const reads: string[] = [];
  for (const name of spec.publicNames) {
    const file = await definingFile(spec.entry, name);
    if (!files.includes(file)) throw new Error(`${name}: ${file} is not in the bundle`);
    reads.push(`${name}: ${scopeName(file)}.${name}`);
  }
  return reads.join(', ');
}

/** The bundle's text, formatted as the repository formats code. */
export async function bundleModules(spec: BundleSpec): Promise<string> {
  const files = await moduleOrder(spec);
  const names = files.map(scopeName);
  if (new Set(names).size !== names.length) throw new Error(`Two modules share a name: ${names}`);
  const scopes = await Promise.all(files.map(moduleScope));
  const code = [
    spec.header,
    ...(await builtinImports(files)),
    `const ${spec.globalName} = (() => {`,
    ...scopes,
    `return { ${await publicReads(spec, files)} };`,
    '})();',
    ...(spec.footer === undefined ? [] : [spec.footer]),
  ].join('\n');
  const prettier = await import('prettier');
  const options = await prettier.resolveConfig(spec.outPath);
  return prettier.format(code, { ...options, filepath: spec.outPath });
}
