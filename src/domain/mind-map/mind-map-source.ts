import type { OutgoingLink } from '../index/index.ts';
import { foldedLinkName } from '../links/index.ts';
import { isTagWithin, type TagCount } from '../tags/index.ts';
import { noteTitle, type VaultPath } from '../vault/index.ts';

/**
 * What the mind map asks of the vault: the index's own answers, one note or
 * one tag at a time. `VaultIndex` is one; nothing here rebuilds it.
 */
export interface MindMapSource {
  has(path: VaultPath): boolean;
  outgoing(path: VaultPath): readonly OutgoingLink[];
  backlinks(path: VaultPath): readonly VaultPath[];
  tagsOf(path: VaultPath): readonly { key: string; name: string }[];
  notesWithTag(key: string, options: { nested: boolean }): readonly VaultPath[];
  tagCounts(): readonly TagCount[];
}

/** One thing on the map that can be a root or a branch's end. */
export type MapEntity =
  | { readonly kind: 'note'; readonly path: VaultPath }
  /** A link target no note answers to yet: `key` is folded, `target` as written. */
  | { readonly kind: 'ghost'; readonly key: string; readonly target: string }
  | { readonly kind: 'tag'; readonly key: string; readonly name: string };

/** The note or tag a map is drawn from. */
export type MapRoot =
  | { readonly kind: 'note'; readonly path: VaultPath }
  | { readonly kind: 'tag'; readonly key: string };

/** The labeled branches an entity's children are grouped into. */
export type BranchKind = 'links' | 'backlinks' | 'tags' | 'subtags' | 'notes';

export interface Branch {
  readonly kind: BranchKind;
  /** Sorted; every one of them, before any cap. */
  readonly entities: readonly MapEntity[];
}

const TRANSCRIPT_FOLDER = 'Transcripts/';
const TRANSCRIPT_SUFFIX = ' (transcript)';

/** A meeting's raw transcript: under `Transcripts/`, or named `… (transcript).md`. */
export function isTranscript(path: VaultPath): boolean {
  return (
    path.startsWith(TRANSCRIPT_FOLDER) || noteTitle(path).toLowerCase().endsWith(TRANSCRIPT_SUFFIX)
  );
}

/** Who an entity is, the same wherever it shows: what a cycle is spotted by. */
export function entityKey(entity: MapEntity | MapRoot): string {
  switch (entity.kind) {
    case 'note':
      return `note:${entity.path}`;
    case 'ghost':
      return `ghost:${entity.key}`;
    case 'tag':
      return `tag:${entity.key}`;
  }
}

/** What an entity is called on the map: a note's title, a tag as `#name`. */
export function entityTitle(entity: MapEntity): string {
  switch (entity.kind) {
    case 'note':
      return noteTitle(entity.path);
    case 'ghost':
      return entity.target;
    case 'tag':
      return `#${entity.name}`;
  }
}

const byCode = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Alphabetical by title, case aside, then by key: the index holds no dates,
 * and a stable order is what lets a hub note be walked twice the same way.
 */
export function compareEntities(left: MapEntity, right: MapEntity): number {
  return (
    byCode(entityTitle(left).toLowerCase(), entityTitle(right).toLowerCase()) ||
    byCode(entityKey(left), entityKey(right))
  );
}

/** The entity a root stands for, or null when its note is gone. */
export function rootEntity(source: MindMapSource, root: MapRoot): MapEntity | null {
  if (root.kind === 'note') return source.has(root.path) ? root : null;
  const known = source.tagCounts().some((tag) => isTagWithin(tag.key, root.key));
  return known ? { kind: 'tag', key: root.key, name: tagName(source, root.key) } : null;
}

/** A tag as the index spells it; a parent never written alone takes its child's spelling. */
function tagName(source: MindMapSource, key: string): string {
  const counts = source.tagCounts();
  const exact = counts.find((tag) => tag.key === key);
  if (exact !== undefined) return exact.name;
  const nested = counts.find((tag) => isTagWithin(tag.key, key));
  return nested === undefined ? key : nested.name.slice(0, key.length);
}

interface BranchOptions {
  readonly transcripts: boolean;
}

/** An entity's children, branch by branch, empty branches left out. */
export function branchesOf(
  source: MindMapSource,
  entity: MapEntity,
  options: BranchOptions,
): Branch[] {
  const keep = (path: VaultPath) => options.transcripts || !isTranscript(path);
  const branches: Branch[] =
    entity.kind === 'note'
      ? noteBranches(source, entity.path, keep)
      : entity.kind === 'tag'
        ? tagBranches(source, entity.key, keep)
        : [];
  return branches
    .filter((branch) => branch.entities.length > 0)
    .map((branch) => ({ ...branch, entities: [...branch.entities].sort(compareEntities) }));
}

/** Whether an entity has any children at all: what decides if it gets an expander. */
export function hasBranches(
  source: MindMapSource,
  entity: MapEntity,
  options: BranchOptions,
): boolean {
  return branchesOf(source, entity, options).length > 0;
}

function noteBranches(
  source: MindMapSource,
  path: VaultPath,
  keep: (path: VaultPath) => boolean,
): Branch[] {
  const notes = (paths: readonly VaultPath[]): MapEntity[] =>
    paths.filter(keep).map((found) => ({ kind: 'note', path: found }));
  return [
    { kind: 'links', entities: linksOutOf(source, path, keep) },
    { kind: 'backlinks', entities: notes(source.backlinks(path)) },
    {
      kind: 'tags',
      entities: source.tagsOf(path).map(({ key, name }) => ({ kind: 'tag', key, name })),
    },
  ];
}

/** A note's links, each target once; a link to itself left out. */
function linksOutOf(
  source: MindMapSource,
  path: VaultPath,
  keep: (path: VaultPath) => boolean,
): MapEntity[] {
  const found = new Map<string, MapEntity>();
  for (const link of source.outgoing(path)) {
    if (link.resolved === path || (link.resolved !== null && !keep(link.resolved))) continue;
    const entity: MapEntity =
      link.resolved === null
        ? { kind: 'ghost', key: foldedLinkName(link.target), target: link.target.trim() }
        : { kind: 'note', path: link.resolved };
    const key = entityKey(entity);
    if (!found.has(key)) found.set(key, entity);
  }
  return [...found.values()];
}

function tagBranches(
  source: MindMapSource,
  key: string,
  keep: (path: VaultPath) => boolean,
): Branch[] {
  const notes = source.notesWithTag(key, { nested: false }).filter(keep);
  return [
    { kind: 'subtags', entities: childTags(source, key) },
    { kind: 'notes', entities: notes.map((path) => ({ kind: 'note', path })) },
  ];
}

/** The tags one level under `key`: `#a/b` under `#a`, whether or not `#a/b` is ever written alone. */
function childTags(source: MindMapSource, key: string): MapEntity[] {
  const found = new Map<string, string>();
  for (const tag of source.tagCounts()) {
    if (!tag.key.startsWith(`${key}/`)) continue;
    const segment = tag.key.slice(key.length + 1).split('/')[0] as string;
    const childKey = `${key}/${segment}`;
    if (!found.has(childKey)) found.set(childKey, tag.name.slice(0, childKey.length));
  }
  return [...found].map(([childKey, name]) => ({ kind: 'tag', key: childKey, name }));
}
