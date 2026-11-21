import { MeetingInputError, type MeetingAttendee } from './meeting-input.ts';

const EMAIL = /^[^\s@]+@[^\s@]+$/;
/** Punctuation a list leaves after an address (`ann@example.com,`), never part of it. */
const TRAILING_PUNCTUATION = /[,;.]+$/;
const BULLET = /^\s*[-*+]\s+/;
/** `[text](mailto:address)`, as email bodies write an address. */
const MAIL_LINK = /\[[^\]]*\]\(mailto:([^)\s]+)\)/gi;
/** `Name — email`, `Name – email`, `Name - email`. */
const DASHED = /^(.*?)\s+[—–-]\s+(\S+@\S+)$/;
/** `Name <email>` or `Name (email)`. */
const BRACKETED = /^(.*?)\s*[<(]\s*(\S+@[^\s>)]+)\s*[>)]$/;
/**
 * An address's local part that names a list, not a person: a group word
 * alone (`staff@`) or joined by `-` or `_` (`platform-team@`, `all_hands@`).
 * A dotted `first.last@` is a person. A list is never linked as a person.
 */
const GROUP_LOCAL_PART =
  /(^|[_-])(team|group|all|everyone|list|staff|crew|squad|dept|department)($|[_-])/i;

const asAddress = (text: string) =>
  text
    .trim()
    .replace(/^mailto:/i, '')
    .replace(TRAILING_PUNCTUATION, '');

const isGroup = (email: string) => GROUP_LOCAL_PART.test(email.slice(0, email.indexOf('@')));

/** An attendee from a written name and address; a name that is itself an address is no name. */
function attendee(rawName: string, rawEmail: string): MeetingAttendee | null {
  const written = rawName.replace(/\s+/g, ' ').trim();
  const nameIsAddress = EMAIL.test(asAddress(written));
  const candidate = asAddress(rawEmail) || (nameIsAddress ? asAddress(written) : '');
  const email = EMAIL.test(candidate) ? candidate : undefined;
  const name = nameIsAddress ? '' : written;
  if (name === '' && email === undefined) return null;
  return email === undefined ? { name } : { name, email };
}

function fromLine(line: string): MeetingAttendee | null {
  const text = line.replace(BULLET, '').replace(MAIL_LINK, '$1').trim();
  if (text === '' || /^-{3,}$/.test(text)) return null;
  const split = DASHED.exec(text) ?? BRACKETED.exec(text);
  if (split !== null) return attendee(split[1] ?? '', split[2] ?? '');
  const bare = text.replace(TRAILING_PUNCTUATION, '');
  return EMAIL.test(bare) ? attendee('', bare) : attendee(text, '');
}

function fromEntry(entry: unknown): MeetingAttendee | null {
  if (typeof entry === 'string') return fromLine(entry);
  if (typeof entry === 'object' && entry !== null) {
    const { name, email } = entry as Record<string, unknown>;
    return attendee(typeof name === 'string' ? name : '', typeof email === 'string' ? email : '');
  }
  throw new MeetingInputError(`attendees: expected lines or { name, email }, got ${typeof entry}`);
}

function entries(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  const split = (each: unknown) => (typeof each === 'string' ? each.split(/\r\n?|\n/) : [each]);
  if (typeof value === 'string') return split(value);
  if (Array.isArray(value)) return value.flatMap(split);
  throw new MeetingInputError(`attendees: expected lines or a list, got ${typeof value}`);
}

/**
 * The attendees, from `{ name, email }` records or Gemini's `Name — email`
 * lines (`Name <email>`, a bare address, a mailto link). The same address
 * twice is one attendee, the one with a display name winning. Mailing lists
 * (`platform-team@…`) are left out: they are not people to link.
 */
export function readGeminiAttendees(value: unknown): MeetingAttendee[] {
  const byKey = new Map<string, MeetingAttendee>();
  for (const entry of entries(value)) {
    const read = fromEntry(entry);
    if (read === null || (read.email !== undefined && isGroup(read.email))) continue;
    const key = (read.email ?? read.name).toLowerCase();
    const kept = byKey.get(key);
    if (kept === undefined || (kept.name === '' && read.name !== '')) byKey.set(key, read);
  }
  return [...byKey.values()];
}
