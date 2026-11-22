import { SECTION_ORDER } from './meeting-note.ts';

/*
 * A provider's prose as the body of one meeting-note section, as DFAI's
 * mapping writes it: `#` and `##` headings made `###`, so they stay inside
 * the section instead of opening one of their own; a heading that names a
 * section (`## Notes` inside a summary) made bold text, so a merge never
 * reads it as that section; a code fence left open closed, so it cannot
 * swallow the sections after it.
 */

const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const TOP_HEADING = /^ {0,3}#{1,2}(?=[ \t]|$)/;
const NAMED_HEADING = new RegExp(
  `^ {0,3}#{1,6}[ \\t]+(${SECTION_ORDER.join('|')})(?:[ \\t]+#+)?[ \\t]*$`,
  'i',
);

function proseLine(line: string): string {
  const named = NAMED_HEADING.exec(line);
  if (named !== null) return `**${named[1]}**`;
  return line.replace(TOP_HEADING, '###');
}

export function sectionProse(text: string): string {
  const written: string[] = [];
  let fence: string | null = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close !== undefined && close[0] === fence[0] && close.length >= fence.length)
        fence = null;
      written.push(line);
      continue;
    }
    fence = FENCE_OPEN.exec(line)?.[1] ?? null;
    written.push(fence === null ? proseLine(line) : line);
  }
  if (fence !== null) written.push(fence);
  return written.join('\n').trim();
}
