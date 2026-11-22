import { MeetingInputError } from './meeting-input.ts';

/*
 * Instants as a provider sends them, and the time of day a clock in a given
 * zone shows for one, as DFAI's mapping reads them. The zone is passed in,
 * never read from the Mac here, so the same note and zone give the same
 * bytes wherever they are mapped.
 */

/** `YYYY-MM-DD` and `HH:MM:SS` as a clock in the zone shows an instant. */
export interface WallTime {
  readonly day: string;
  readonly time: string;
}

const RFC_3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

/**
 * Milliseconds since the epoch for an RFC 3339 instant, or null when the text
 * is not one. An instant with no offset is not read: it would be taken on
 * the Mac's own clock. A day or time out of range (Feb 30, 24:00) is refused.
 */
export function rfc3339Instant(text: string): number | null {
  const match = RFC_3339.exec(text);
  if (match === null) return null;
  const at = (group: number) => Number(match[group] ?? '0');
  const [year, month, day, hour, minute, second] = [at(1), at(2), at(3), at(4), at(5), at(6)];
  if (hour > 23 || minute > 59 || second > 59 || at(10) > 23 || at(11) > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const millis = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
  const east = match[8] !== undefined ? 0 : (match[9] === '-' ? -1 : 1) * (at(10) * 60 + at(11));
  return wall + millis - east * 60_000;
}

/** A clock in `timeZone`; refused by name when the zone is no zone. */
export function wallClockIn(timeZone: string): (instant: number) => WallTime {
  let clock: Intl.DateTimeFormat;
  try {
    clock = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    // Intl's RangeError for an unknown zone, said in the mapper's own words.
    throw new MeetingInputError(`timeZone: ${JSON.stringify(timeZone)} is not a time zone`);
  }
  return (instant) => {
    const parts = clock.formatToParts(instant);
    const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
    return {
      day: `${part('year')}-${part('month')}-${part('day')}`,
      time: `${part('hour')}:${part('minute')}:${part('second')}`,
    };
  };
}
