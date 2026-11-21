import type { TranscriptTurn } from './meeting-input.ts';

/** Gemini's wrapper lines: `<details>`, `📖 Transcript`, the end mark, a date alone. */
const WRAPPER = [
  /^<\/?(details|summary)\b[^>]*>(.*<\/summary>)?$/i,
  /^(📖\s*)?transcript$/i,
  /^(#{1,6}\s*)?transcription ended after\b/i,
  /^((mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?[a-z]{3,9}\.?\s+\d{1,2},\s+\d{4}$/i,
  /^\d{4}-\d{2}-\d{2}$/,
];
/** The doc's title line, `## Transcript` or `Title - Transcript`: a wrapper only above the first turn. */
const TITLE_LINE = /^(?:#{1,6}\s*)?(?:.*\s[-–—]\s*)?transcript$/i;
/** Gemini's section stamp, `### 00:09:44`: the time the turns under it were spoken, roughly. */
const SECTION = /^(?:#{1,6}\s*)?(\d{1,2}:[0-5]\d:[0-5]\d)$/;
/** A turn: `Speaker Name: words`, `**Speaker Name:** words` or `**Speaker Name**: words`. */
const SPOKEN = /^(?:\*\*)?([^:*\s][^:*]{0,79}?)(?:\*\*)?\s*:(?:\*\*)?(?:\s+(.*))?$/;
const BULLET = /^[-*+]\s+/;
const FENCE = /^(?:```|~~~)/;
/**
 * Labels that are never a person speaking: words a note line opens with
 * (`Note:`, `Action item:`, `URL:` …). A line opening with one continues the
 * turn before. Nothing else is ruled out: a Gemini speaker need not be an
 * attendee (a shared room, a group invite).
 */
const NOTE_LABEL =
  /^(?:note|notes|nb|ps|fyi|re|todo|to do|action items?|next steps?|decisions?|questions?|answers?|agenda|summary|update|reminder|link|url|https?|e-?mail|phone|subject|date|time)$/i;

interface OpenTurn {
  readonly speaker: string;
  readonly time: string | null;
  readonly parts: string[];
}

/** A line without its indent and without Notion's `\[`, `\]` and `\*` escapes. */
const plain = (line: string) => line.trim().replace(/\\([[\]*_])/g, '$1');
const padded = (time: string) => (time.length === 7 ? `0${time}` : time);

function speakerOf(line: string): { speaker: string; words: string } | null {
  const match = SPOKEN.exec(line.replace(BULLET, ''));
  const label = match?.[1]?.trim();
  if (match === null || label === undefined || NOTE_LABEL.test(label)) return null;
  return { speaker: label, words: match[2] ?? '' };
}

function isWrapper(line: string, beforeFirst: boolean): boolean {
  return WRAPPER.some((each) => each.test(line)) || (beforeFirst && TITLE_LINE.test(line));
}

/**
 * The turns of a Gemini transcript: `Speaker: words` lines under
 * `### hh:mm:ss` section stamps, each turn taking its section's time. A line
 * with no speaker continues the turn before (or is a turn nobody was named
 * for). The wrapper, date and end lines are dropped; inside a code fence,
 * every line is words.
 */
export function readGeminiTranscript(transcript: string): TranscriptTurn[] {
  const turns: OpenTurn[] = [];
  let section: string | null = null;
  let inFence = false;
  for (const raw of transcript.split(/\r\n?|\n/)) {
    const line = plain(raw);
    if (FENCE.test(line)) inFence = !inFence;
    if (line === '' || (!inFence && isWrapper(line, turns.length === 0 && section === null))) {
      continue;
    }
    const stamp = inFence ? null : SECTION.exec(line);
    if (stamp !== null) {
      section = padded(stamp[1] ?? '');
      continue;
    }
    const spoken = inFence ? null : speakerOf(line);
    const last = turns.at(-1);
    if (spoken !== null)
      turns.push({ speaker: spoken.speaker, time: section, parts: [spoken.words] });
    else if (last === undefined) turns.push({ speaker: '', time: section, parts: [line] });
    else last.parts.push(line);
  }
  return turns
    .map(({ speaker, time, parts }) => ({
      speaker,
      ...(time === null ? {} : { time }),
      text: parts.join(' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter((turn) => turn.text !== '');
}
