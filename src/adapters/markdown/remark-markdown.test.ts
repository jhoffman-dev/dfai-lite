import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from '../../domain/markdown/index.ts';
import { remarkMarkdown } from './remark-markdown.ts';
import { ROUND_TRIP_CORPUS } from './round-trip-corpus.ts';

/*
 * The port the editor saves every note through: a note is read into the
 * editor's document and written back with every block the person did not
 * touch in its own bytes, and a frontmatter block, which Lite never shows
 * for editing, exactly as it was. Fictional data only.
 */

const { parseNote, serializeNote } = remarkMarkdown;

/** The note saved with nothing changed. */
const untouched = (text: string): string => {
  const note = parseNote(text);
  return serializeNote(note, note.parsed.doc);
};

/** The note saved with the paragraph whose text is `from` changed to `to`. */
function edited(text: string, from: string, to: string): string {
  const note = parseNote(text);
  let found = false;
  const edit = (node: EditorNode): EditorNode => {
    const only = node.content?.[0];
    if (node.type === 'paragraph' && node.content?.length === 1 && only?.text === from) {
      found = true;
      return { ...node, content: [{ type: 'text', text: to }] };
    }
    return node.content === undefined ? node : { ...node, content: node.content.map(edit) };
  };
  const doc: EditorDocument = { type: 'doc', content: note.parsed.doc.content.map(edit) };
  if (!found) throw new Error(`no paragraph reads ${JSON.stringify(from)}`);
  return serializeNote(note, doc);
}

const FRONTMATTER = '---\ntitle: Garden plan\ntags: [garden]\n---\n';

/** Blocks the editor must keep byte for byte when the paragraph beside them is edited. */
const NEIGHBORS: ReadonlyArray<readonly [label: string, markdown: string]> = [
  ['a wiki link with an alias', 'See [[Garden plan|the plan]] today.'],
  ['a wiki link to a heading', 'See [[Garden plan#Beds]] today.'],
  ['an embed', '![[Seed list]]'],
  ['an image embed with a size', '![[bed.png|300]]'],
  ['tags', '#garden and #area/beds and #tag me#'],
  ['a tag opening a line', '#garden first'],
  ['an HTML block', '<div class="note">raw <b>html</b></div>'],
  ['an HTML comment', '<!-- a comment [[Not a link]] -->'],
  ['an Obsidian comment', '%% hidden [[Note]] %%'],
  ['display math', '$$\nx^2 + [[y]]\n$$'],
  ['a footnote and its definition', 'Text[^1].\n\n[^1]: The note.'],
  ['a link definition', 'See [the site][s].\n\n[s]: https://example.com'],
  ['a table', '| Bed | Crop |\n|:--|--:|\n| 1 | [[Kale]] |\n| 2 | #herbs |'],
  ['a task list', '- [ ] sow #seeds\n- [x] water [[Beds]]\n  - [ ] nested'],
  ['nested lists', '* one\n    * two\n        1. three'],
  ['a fenced code block', '```ts\nconst link = "[[not a link]]"; // #not-a-tag\n```'],
  ['a tilde fence', '~~~\nplain\n~~~'],
  ['hard breaks', 'line one  \nline two\\\nline three'],
  ['escapes', 'a \\* star, a \\[bracket\\], 5 \\# not a tag'],
  ['a block id, as text', 'The plan. ^f3k9x2'],
  ['a lone block id', '^a1'],
  ['a callout', '> [!warning]- Mind the frost\n> Cover the beds.'],
  ['a horizontal rule of stars', '* * *'],
  ['emphasis written with underscores', '__strong__ and _soft_'],
  ['an autolink', '<https://example.com/a_b>'],
  ['an image with a size in its alt text', '![bed|300](<beds/bed one.png>)'],
  [
    'a meeting’s summary block, between its markers',
    '<!-- dfai-lite:summary v1 -->\n\n> [!summary] Summary by Claude (claude-sonnet-5-5, 2026-11-24)\n> Larkspur Payroll renews for a year; the cache flag ships first.\n>\n> **Key points**\n> - Renewal at the current rate\n>\n> **Action items**\n> - Flag the cache before Friday: Tobias Fenn\n\n<!-- /dfai-lite:summary -->',
  ],
];

describe('a note saved with nothing changed', () => {
  it.each(ROUND_TRIP_CORPUS)('keeps %s byte for byte', (_label, markdown) => {
    expect(untouched(markdown)).toBe(markdown);
  });

  it.each(ROUND_TRIP_CORPUS)(
    'keeps %s byte for byte under a frontmatter block',
    (_label, markdown) => {
      expect(untouched(`${FRONTMATTER}${markdown}`)).toBe(`${FRONTMATTER}${markdown}`);
    },
  );
});

describe('a note with one paragraph edited', () => {
  it.each(NEIGHBORS)('keeps %s after it byte for byte', (_label, block) => {
    const text = `Intro.\n\n${block}\n`;
    expect(edited(text, 'Intro.', 'Intro, edited.')).toBe(`Intro, edited.\n\n${block}\n`);
  });

  it.each(NEIGHBORS)('keeps %s before it byte for byte', (_label, block) => {
    const text = `${block}\n\nOutro.\n`;
    expect(edited(text, 'Outro.', 'Outro, edited.')).toBe(`${block}\n\nOutro, edited.\n`);
  });

  it('keeps the spacing between untouched blocks, and a blank line beside the edited one', () => {
    const text = '# Plan\n\n\n\nFirst.\n\nSecond.\n\n\n- a\n-   b\n';
    expect(edited(text, 'Second.', 'Second!')).toBe(
      '# Plan\n\n\n\nFirst.\n\nSecond!\n\n- a\n-   b\n',
    );
  });

  it('keeps CRLF line endings, in the edited block and around it', () => {
    const text = 'One.\r\n\r\n- [ ] two\r\n- [x] three\r\n';
    expect(edited(text, 'One.', 'One, edited.')).toBe(
      'One, edited.\r\n\r\n- [ ] two\r\n- [x] three\r\n',
    );
  });

  it('keeps a note with no trailing newline without one', () => {
    expect(edited('Intro.\n\nLast line', 'Intro.', 'Start.')).toBe('Start.\n\nLast line');
  });

  it('keeps the trailing blank lines a note ends with', () => {
    expect(edited('Intro.\n\nLast.\n\n\n', 'Intro.', 'Start.')).toBe('Start.\n\nLast.\n\n\n');
  });

  it('writes a wiki link and a tag typed into the edited paragraph unescaped', () => {
    const note = parseNote('Old.\n');
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '#idea see ' },
            { type: 'wikiLink', attrs: { target: 'Garden plan', heading: '#Beds', alias: 'beds' } },
            { type: 'text', text: ' and ' },
            {
              type: 'wikiLink',
              attrs: { target: 'bed.png', heading: null, alias: null, embed: true },
            },
          ],
        },
      ],
    };
    expect(serializeNote(note, doc)).toBe('#idea see [[Garden plan#Beds|beds]] and ![[bed.png]]\n');
  });

  it('writes a ticked box as the one change to a task list', () => {
    const note = parseNote('Intro.\n\n- [ ] sow\n- [ ] water\n');
    const tick = (node: EditorNode, at: number): EditorNode =>
      at === 1 ? { ...node, attrs: { ...node.attrs, checked: true } } : node;
    const content = note.parsed.doc.content.map((block): EditorNode =>
      block.type === 'taskList' ? { ...block, content: (block.content ?? []).map(tick) } : block,
    );
    expect(serializeNote(note, { type: 'doc', content })).toBe(
      'Intro.\n\n- [ ] sow\n- [x] water\n',
    );
  });
});

describe('what the editor does not model', () => {
  it.each([
    ['an HTML block', '<div class="note">raw <b>html</b></div>'],
    ['a footnote definition', '[^1]: The note.'],
    ['a link definition', '[s]: https://example.com'],
  ])('reads %s as a raw block holding its markdown exactly', (_label, markdown) => {
    const [block] = parseNote(`${markdown}\n`).parsed.doc.content;
    expect(block?.type).toBe('rawBlock');
    expect(block?.attrs?.['markdown']).toBe(markdown);
  });

  it('writes a raw block moved among edited blocks as its own bytes, never escaped', () => {
    const text = 'Intro.\n\n<span>[[Raw]] #raw *x*</span>\n\nOutro.\n';
    const note = parseNote(text);
    const [intro, raw, outro] = note.parsed.doc.content;
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'New.' }] },
        outro!,
        intro!,
        raw!,
      ],
    };
    expect(serializeNote(note, doc)).toBe(
      'New.\n\nOutro.\n\nIntro.\n\n<span>[[Raw]] #raw *x*</span>\n',
    );
  });
});

describe('a note that still opens with a frontmatter block', () => {
  it('keeps the block out of the editor document', () => {
    const note = parseNote(`${FRONTMATTER}# Beds\n`);
    expect(note.frontmatter).toBe(FRONTMATTER);
    expect(note.parsed.doc.content.map((node) => node.type)).toEqual(['heading']);
  });

  it('keeps the block byte for byte when the body is edited', () => {
    const text = '---\r\ntitle: "Plan: beds"\r\nlist:\r\n  - a\r\n---\r\n\r\nIntro.\r\n';
    expect(edited(text, 'Intro.', 'Changed.')).toBe(
      '---\r\ntitle: "Plan: beds"\r\nlist:\r\n  - a\r\n---\r\n\r\nChanged.\r\n',
    );
  });

  it('keeps a block that closes on the file’s last byte, putting a new body on its own line', () => {
    const note = parseNote('---\na: 1\n---');
    const doc: EditorDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] }],
    };
    expect(serializeNote(note, doc)).toBe('---\na: 1\n---\nBody.\n');
  });

  it('reads a `---` that never closes as the horizontal rule it is', () => {
    const note = parseNote('---\nnot frontmatter\n');
    expect(note.frontmatter).toBeNull();
    expect(note.parsed.doc.content[0]?.type).toBe('horizontalRule');
    expect(untouched('---\nnot frontmatter\n')).toBe('---\nnot frontmatter\n');
  });
});
