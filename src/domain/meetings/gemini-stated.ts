import { MeetingInputError } from './meeting-input.ts';

/** The day, start and title a Gemini email's subject (or its doc's title) states. */
export interface GeminiStated {
  readonly date: string;
  /** `HH:MM` on a 24-hour clock, as written: a zone after it is dropped, never converted. */
  readonly start: string | null;
  readonly title: string;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * A day as Gemini writes it — `Oct 6, 2026`, `October 6 2026`, `2026/10/06`,
 * `2026-10-06` — then a time after it, if any (`10:00`, `2:30 PM`), then a
 * zone (`PDT`, `UTC+1`, `-04:00`), which is read past but not used.
 */
const STATED =
  /(?:\b(\d{4})[-/](\d{2})[-/](\d{2})|\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4}))(?:,?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?(?:\s*(?:[A-Z]{2,5}(?:[+-]\d{1,2}(?::?\d{2})?)?\b|[+-]\d{2}:?\d{2}\b))?)?/gi;
/** What Gemini's email subject puts before a title: `Notes: “…”`. */
const NOTES_PREFIX = /^\s*notes\s*:\s*/i;
const QUOTES = /^["“”'‘’]+|["“”'‘’]+$/g;

const two = (value: number | string) => String(value).padStart(2, '0');

function monthNumber(word: string): number | null {
  const lower = word.toLowerCase();
  const prefix = lower === 'sept' ? 'sep' : lower;
  const at = MONTHS.findIndex((month) => month.startsWith(prefix));
  return at === -1 ? null : at + 1;
}

function dayOf(match: RegExpExecArray): string | null {
  const [, isoYear, isoMonth, isoDay, monthWord, wordDay, wordYear] = match;
  if (isoYear !== undefined) return `${isoYear}-${isoMonth ?? ''}-${isoDay ?? ''}`;
  const month = monthNumber(monthWord ?? '');
  return month === null ? null : `${wordYear ?? ''}-${two(month)}-${two(wordDay ?? '')}`;
}

/** `2:30 PM` → `14:30`; `12:05 AM` → `00:05`; null with no time, or one past 23:59. */
function startOf(match: RegExpExecArray): string | null {
  const [, , , , , , , hourText, minutes, half] = match;
  if (hourText === undefined || minutes === undefined) return null;
  const hour = Number(hourText);
  const meridiem = half?.toLowerCase();
  const hours = meridiem === undefined ? hour : (hour % 12) + (meridiem === 'p' ? 12 : 0);
  return hours > 23 || Number(minutes) > 59 ? null : `${two(hours)}:${minutes}`;
}

/** The title: the words before the stated date, without Gemini's `Notes:`, quotes and dashes. */
function titleBefore(subject: string, at: number): string {
  return subject
    .slice(0, at)
    .replace(NOTES_PREFIX, '')
    .replace(/[\s,]*[-–—]?\s*$/, '')
    .trim()
    .replace(QUOTES, '')
    .trim();
}

/**
 * The meeting's day, start and title as a Gemini subject states them
 * (`Notes: “Weekly sync” Oct 6, 2026`, or the doc title
 * `Weekly sync - 2026/10/06 10:00 PDT - Notes by Gemini`). The last date in
 * the words wins, since a title may hold a date of its own. Refused when
 * there is no date: the arrival of the email is not the meeting's day.
 */
export function readGeminiSubject(subject: string): GeminiStated {
  const found = [...subject.matchAll(STATED)].filter((match) => dayOf(match) !== null);
  const last = found.at(-1);
  if (last === undefined)
    throw new MeetingInputError(`subject: no date in ${JSON.stringify(subject)}`);
  return {
    date: dayOf(last) ?? '',
    start: startOf(last),
    title: titleBefore(subject, last.index),
  };
}
