import { SECTION_ORDER } from './meeting-note.ts';

/*
 * A provider's prose as the body of one meeting-note section, as DFAI's
 * mapping writes it: `#` and `##` headings made `###`, so they stay inside
 * the section instead of opening one of their own; a heading that names a
 * section (`## Notes` inside a summary) made bold text, so a merge never
 * reads it as that section; a code fence left open closed, so it cannot
 * swallow the sections after it. And, Lite's own rule, no picture from the
 * web: an image would be fetched from its server as the note opens, so each
 * one is written as a plain link to it.
 */

const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const TOP_HEADING = /^ {0,3}#{1,2}(?=[ \t]|$)/;
const NAMED_HEADING = new RegExp(
  `^ {0,3}#{1,6}[ \\t]+(${SECTION_ORDER.join('|')})(?:[ \\t]+#+)?[ \\t]*$`,
  'i',
);

/** `![alt](address)` and `![alt][label]`: markdown pictures, inline or by reference. */
const MARKDOWN_IMAGE = /!\[([^\]]*)\](?=[([])/g;
/** An HTML picture, with the address it would load. */
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)[^>]*>/gi;

/**
 * The text with every picture written as a link: `![alt](https://…)` becomes
 * `[alt](https://…)` (`[image](…)` with no alt), and `<img src="…">` a link
 * to its address. Wiki links and ordinary links are left as they are.
 */
export function withoutRemoteImages(text: string): string {
  return text
    .replace(MARKDOWN_IMAGE, (_, alt: string) => `[${alt.trim() === '' ? 'image' : alt}]`)
    .replace(HTML_IMAGE, (_, address: string) => `[image](${address})`);
}

function proseLine(line: string): string {
  const named = NAMED_HEADING.exec(line);
  if (named !== null) return `**${named[1]}**`;
  return withoutRemoteImages(line.replace(TOP_HEADING, '###'));
}

/** A provider's prose as a section's body (see above). */
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
