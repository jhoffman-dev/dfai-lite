// How one DFAI note becomes a DFAI Lite note: pure, so the rules are tested
// without a file system. The migration tool does the reading and writing.
import { noteSummary } from '../src/domain/index/index.ts';
import { noteTags, tagKey } from '../src/domain/tags/index.ts';
import { cleanNoteName, fileNameOf, folderOf, joinPath } from '../src/domain/vault/index.ts';
import { readFrontmatter, type FrontmatterValue, type UnconvertedLines } from './frontmatter.ts';

/** What happened to a note, for the report's counts. */
export type ConversionRule = 'plain' | 'frontmatter' | 'meeting' | 'person';

export interface ConvertedNote {
  /** Where the note goes in the new vault (before any name clash is settled). */
  readonly path: string;
  readonly text: string;
  readonly rule: ConversionRule;
  readonly favorite: boolean;
  /** Properties left out of the new note, by key. */
  readonly dropped: readonly string[];
  /** Properties with nothing in them (`[]`, `''`, no value), left out, by key. */
  readonly empty: readonly string[];
  /** Frontmatter the reader did not understand, kept verbatim in the note: by key, or the line. */
  readonly unconverted: readonly string[];
  /** Frontmatter comments: whole-line ones are in the unconverted block, ones after a value are dropped. */
  readonly comments: number;
  /** Whether a UTF-8 byte-order mark was taken off the front. */
  readonly bom: boolean;
}

const BOM = '﻿';

/** DFAI's bookkeeping: carries nothing a reader needs. */
const BOOKKEEPING = /^(?:atlas_.*|type|id|created|modified)$/;
/** Meeting-import bookkeeping (`meeting-import-v1`): how the importer worked, not what was said. */
const MEETING_BOOKKEEPING = new Set([
  'provider',
  'external_id',
  'transcript_clock',
  'start_approximate',
  'start_source',
]);
/** Read into a meeting's header lines rather than the property list. */
const MEETING_KEYS = new Set(['title', 'date', 'start', 'end', 'attendees', 'project']);
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function convertNote({ path, text: raw }: { path: string; text: string }): ConvertedNote {
  const bom = raw.startsWith(BOM);
  const text = bom ? raw.slice(BOM.length) : raw;
  const { properties, body, unconverted, comments } = readFrontmatter(text);
  const read = { bom, comments, unconverted: unconverted.map(({ label }) => label) };
  if (properties.size === 0 && body === text) {
    return { path, text, rule: 'plain', favorite: false, dropped: [], empty: [], ...read };
  }
  const type = properties.get('type');
  const favorite = properties.get('favorite') === true;
  const kept = unconvertedBlock(unconverted);
  if (type === 'meeting') {
    const meeting = meetingNote(properties, body, kept);
    if (meeting !== null) return { ...meeting, favorite, ...read };
  }
  const isKept = (key: string): boolean => !BOOKKEEPING.test(key);
  const dropped = [...properties.keys()].filter((key) => !isKept(key));
  const lines = keptProperties(properties, isKept);
  const newPath = type === 'person' ? joinPath('People', fileNameOf(path)) : path;
  return {
    path: newPath,
    text: withHeader(body, [tagsLine(properties.get('tags'), body), lines.join('\n'), kept]),
    rule: type === 'person' ? 'person' : 'frontmatter',
    favorite,
    dropped,
    empty: emptyKeys(properties, isKept),
    ...read,
  };
}

/**
 * The frontmatter the reader could not take apart, verbatim in a fenced block,
 * so nothing a DFAI note carried is lost; '' when there is none.
 */
function unconvertedBlock(unconverted: readonly UnconvertedLines[]): string {
  if (unconverted.length === 0) return '';
  const lines = unconverted.flatMap(({ lines: written }) => written);
  const longestRun = Math.max(0, ...lines.map((line) => /`+/.exec(line)?.[0].length ?? 0));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return [
    'Unconverted DFAI properties, kept as they were written:',
    '',
    `${fence}yaml`,
    ...lines,
    fence,
  ].join('\n');
}

/** Keys a reader would have seen that hold nothing, so the note leaves them out. */
function emptyKeys(
  properties: ReadonlyMap<string, FrontmatterValue>,
  isKept: (key: string) => boolean,
): string[] {
  return [...properties]
    .filter(([key, value]) => key !== 'favorite' && isKept(key) && displayValue(value) === '')
    .map(([key]) => key);
}

function meetingNote(
  properties: ReadonlyMap<string, FrontmatterValue>,
  body: string,
  kept: string,
): Omit<ConvertedNote, 'favorite' | 'bom' | 'unconverted' | 'comments'> | null {
  const date = properties.get('date');
  const title = properties.get('title');
  const match = typeof date === 'string' ? DATE.exec(date) : null;
  if (match === null) return null;
  const name = cleanNoteName(`${date} ${typeof title === 'string' ? title : ''}`);
  const isKept = (key: string): boolean =>
    !BOOKKEEPING.test(key) && !MEETING_BOOKKEEPING.has(key) && !MEETING_KEYS.has(key);
  const dropped = [...properties.keys()].filter(
    (key) => BOOKKEEPING.test(key) || MEETING_BOOKKEEPING.has(key),
  );
  const header = [
    `- When: ${when(properties)}`,
    ...attendeesLine(properties.get('attendees')),
    ...aboutLine(properties.get('project')),
    ...keptProperties(properties, isKept),
  ];
  const sentence = openingSentence(body);
  const tags = tagsLine(properties.get('tags'), body);
  const opening = [
    sentence,
    tags,
    noteTags(body).some(({ key }) => key === 'meeting') ? '' : '#meeting',
  ]
    .filter((part) => part !== '')
    .join(' ');
  const head = [opening, header.join('\n'), kept].filter((part) => part !== '').join('\n\n');
  const text = `${head}\n\n${body.replace(/^\s+/, '')}`;
  return {
    path: `Meetings/${match[1]}/${match[2]}/${name}.md`,
    text: text.replace(/\n*$/, '\n'),
    rule: 'meeting',
    dropped,
    empty: emptyKeys(properties, (key) => !BOOKKEEPING.test(key) && !MEETING_BOOKKEEPING.has(key)),
  };
}

function when(properties: ReadonlyMap<string, FrontmatterValue>): string {
  const [date, start, end] = ['date', 'start', 'end'].map((key) => properties.get(key));
  const time =
    typeof start === 'string' ? ` ${start}${typeof end === 'string' ? `–${end}` : ''}` : '';
  return `${String(date)}${time}`;
}

/** `- With:` — people as links; a group address as plain text, since it never becomes a person. */
function attendeesLine(value: FrontmatterValue | undefined): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const names = (value as readonly (string | Readonly<Record<string, string | boolean>>)[]).map(
    (entry) => {
      if (typeof entry === 'string') return `[[${entry}]]`;
      const name = String(entry['name'] ?? '').trim();
      return entry['group'] === true ? name : `[[${name}]]`;
    },
  );
  return [`- With: ${names.filter((name) => name !== '' && name !== '[[]]').join(', ')}`];
}

function aboutLine(value: FrontmatterValue | undefined): string[] {
  const text = displayValue(value).replace(/\s*\n\s*/g, ' ');
  if (text === '') return [];
  return [`- About: ${text.startsWith('[[') ? text : `[[${text}]]`}`];
}

/** `- Key: value` lines for the properties a reader still needs. Tags and favourite have homes of their own. */
function keptProperties(
  properties: ReadonlyMap<string, FrontmatterValue>,
  isKept: (key: string) => boolean,
): string[] {
  const lines: string[] = [];
  for (const [key, value] of properties) {
    if (key === 'tags' || key === 'favorite' || !isKept(key)) continue;
    const text = displayValue(value);
    if (text === '') continue;
    const label = `- ${key.charAt(0).toUpperCase()}${key.slice(1)}:`;
    lines.push(text.includes('\n') ? multiLine(label, text) : `${label} ${text}`);
  }
  return lines;
}

/** A multi-line value as its label, then each line indented under it, so it reads as one list item. */
function multiLine(label: string, text: string): string {
  const lines = text.split('\n').map((line) => (line.trim() === '' ? '' : `  ${line}`));
  return [label, ...lines].join('\n');
}

function displayValue(value: FrontmatterValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  return value
    .map((item) =>
      typeof item === 'string'
        ? item
        : Object.entries(item)
            .map(([key, entry]) => `${key} ${String(entry)}`)
            .join(', '),
    )
    .join('; ');
}

/** The `tags:` property as inline tags, leaving out any the body already has. */
function tagsLine(value: FrontmatterValue | undefined, body: string): string {
  const raw =
    typeof value === 'string'
      ? value.split(',')
      : Array.isArray(value)
        ? (value as readonly unknown[]).filter((tag): tag is string => typeof tag === 'string')
        : [];
  const present = new Set(noteTags(body).map(({ key }) => key));
  const tags: string[] = [];
  for (const tag of raw) {
    const name = tag.trim().replace(/^#/, '').replace(/\s+/g, '-');
    if (name === '' || present.has(tagKey(name))) continue;
    present.add(tagKey(name));
    tags.push(`#${name}`);
  }
  return tags.join(' ');
}

/**
 * The body with the header blocks (tags line, property list, unconverted
 * frontmatter) after its first paragraph, so the note still opens with its sentence.
 */
function withHeader(body: string, header: readonly string[]): string {
  const blocks = header.filter((block) => block !== '');
  const trimmed = body.replace(/^\s+/, '');
  if (blocks.length === 0) return trimmed;
  const lines = trimmed.split('\n');
  const end = firstParagraphEnd(lines);
  const before = lines.slice(0, end).join('\n');
  const after = lines.slice(end).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
  const parts = [before, ...blocks, after].filter((part) => part.trim() !== '');
  return `${parts.join('\n\n')}\n`;
}

/** The line after the note's first prose paragraph; 0 when the note opens with no prose. */
function firstParagraphEnd(lines: readonly string[]): number {
  const first = lines[0] ?? '';
  if (first.trim() === '' || /^\s*(?:#{1,6}\s|```|~~~|\||<)/.test(first)) return 0;
  const blank = lines.findIndex((line) => line.trim() === '');
  return blank === -1 ? lines.length : blank;
}

/**
 * The first sentence of the body's first prose paragraph, its wrapped lines
 * joined first, so a sentence that runs over a line break is not cut.
 */
function openingSentence(body: string): string {
  const lines = body.split(/\r?\n/);
  let inFence = false;
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] as string;
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence || line.trim() === '' || NOT_PROSE.test(line)) continue;
    const paragraph: string[] = [];
    while (at < lines.length && (lines[at] as string).trim() !== '') {
      paragraph.push((lines[at] as string).trim());
      at += 1;
    }
    return noteSummary(paragraph.join(' '));
  }
  return '';
}

const FENCE = /^\s*(?:```|~~~)/;
const NOT_PROSE = /^\s*(?:#{1,6}(?:\s|$)|[-*_]{3,}\s*$|\||```|~~~)/;

/** A path made unique among `taken` (folded): `Name 2.md`, `Name 3.md`… */
export function uniquePath(path: string, taken: ReadonlySet<string>): string {
  const fold = (candidate: string): string => candidate.normalize('NFC').toLowerCase();
  if (!taken.has(fold(path))) return path;
  const stem = fileNameOf(path).replace(/\.md$/i, '');
  const extension = fileNameOf(path).slice(stem.length);
  for (let number = 2; ; number += 1) {
    const candidate = joinPath(folderOf(path), `${stem} ${number}${extension}`);
    if (!taken.has(fold(candidate))) return candidate;
  }
}
