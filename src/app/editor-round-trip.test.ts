// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { blockRenderer, remarkMarkdown } from '../adapters/markdown/index.ts';
import type { EditorDocument } from '../domain/markdown/index.ts';
import { editable } from '../ui/editor/editable-doc.ts';
import { createEditorExtensions } from '../ui/editor/extensions.ts';

/*
 * Real-world-shaped notes through the real editor: read by the remark
 * adapter, loaded into the TipTap schema the app builds, and written back.
 * Opening a note and focusing it must write nothing new; typing one
 * character in one block must leave every other block's bytes alone.
 * Every name here is made up.
 */

const NOTES: Readonly<Record<string, string>> = {
  'CRLF line endings': '# Plan\r\n\r\nFirst line.\r\n\r\n- one\r\n- two\r\n',
  tabs: '- top\n\t- nested with a tab\n\nA\ttab inside.\n',
  'star and underscore emphasis':
    'Some *star* and _under_ and __strong__ and **strong**.\n\nNext.\n',
  'a list numbered 1. 1. 3.': '1. first\n1. second\n3. third\n\nAfter.\n',
  'parenthesis numbers': '1) first\n2) second\n\nAfter.\n',
  entities: 'AT&amp;T &copy; 2026 &nbsp;spaced &#35;not-a-tag\n\nNext.\n',
  'byte-order mark': '﻿# Title\n\nBody.\n',
  'no final newline': '# Title\n\nBody without an ending',
  empty: '',
  'frontmatter only': '---\ntags: [old]\n---\n',
  'frontmatter and body': '---\ncreated: 2024-01-02\n---\n\nBody.\n',
  'HTML blocks': '<details>\n<summary>More</summary>\n\nHidden.\n</details>\n\nAfter.\n',
  comments: '<!-- a comment -->\n\nText.\n\n%% an Obsidian comment %%\n',
  footnotes: 'Text with a note.[^1]\n\n[^1]: The note itself.\n',
  'reference links':
    'See [the site][site] and [this].\n\n[site]: https://example.com\n[this]: https://example.com/this "Title"\n',
  'block ids': 'A paragraph with an id. ^abc123\n\n^standalone\n\nAfter.\n',
  embeds: '![[Diagram.png]]\n\nText with ![[Other note]] inline.\n',
  'math blocks': '$$\nE = mc^2\n$$\n\nInline $x_1$ math.\n',
  'Obsidian callouts':
    '> [!warning] Watch out\n> The body of it.\n\n> [!tip]\n> A tip.\n\nAfter.\n',
  highlights: 'Some ==highlighted== words.\n\nNext.\n',
  'nested quote, list and code':
    '> A quote\n> - with a list\n>   - nested\n>\n> ```js\n> const x = 1;\n> ```\n\n- item\n\n  ```\n  code in a list\n  ```\n',
  'wiki links':
    'See [[Mara Quill|Mara]] and [[Larkspur Payroll#Goals]] and [[Plan#^abc123]].\n\nNext.\n',
  'a table with a piped link':
    '| Who | Link |\n| --- | --- |\n| Tobias | [[Tobias Fenn\\|Tobias]] |\n\nAfter.\n',
  'tags and not tags':
    'C# and #1 are not tags; #a/b and #project are. See https://example.com/page#part.\n\nNext.\n',
  'aligned table':
    '| Left | Right | Center |\n|:--|--:|:-:|\n| a | 1 | x |\n| b | 22 | y |\n\nAfter the table.\n',
  'task lists': '- [ ] open\n- [x] done\n  - [ ] nested\n\nAfter.\n',
  'hard breaks': 'Line one  \nline two\\\nline three\n\nNext.\n',
  'a long mixed note':
    '# Weekly sync\n\n**When:** 2026-11-21  \n**With:** [[Mara Quill]]\n\n## Notes\n\n* point one\n* point two\n\n---\n\n```bash\npayroll export --cycle 1\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n',
};

const extensions = () =>
  createEditorExtensions({
    suggest: () => [],
    onView: () => undefined,
    onSlashView: () => undefined,
    suggestTags: () => [],
    onTagView: () => undefined,
    onOpenTag: () => undefined,
    createNote: () => undefined,
    loadImage: async () => null,
  });

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** The note opened in the app's editor, focused as a click would, and how it saves. */
function open(text: string) {
  const note = remarkMarkdown.parseNote(text);
  const editor = new Editor({
    extensions: extensions(),
    content: editable(note.parsed.doc) as object,
  });
  editors.push(editor);
  editor.commands.focus('start');
  editor.commands.focus('end');
  const save = () => remarkMarkdown.serializeNote(note, editor.getJSON() as EditorDocument);
  return { note, editor, save };
}

/** Where the first text of top-level block `index` starts, or null when it holds none. */
function firstTextIn(doc: ProseMirrorNode, index: number): number | null {
  let offset = 0;
  for (let at = 0; at < index; at += 1) offset += doc.child(at).nodeSize;
  const block = doc.child(index);
  if (block.isTextblock) return offset + 1;
  let found: number | null = null;
  block.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isTextblock) found = offset + 1 + pos + 1;
    return found === null;
  });
  return found;
}

describe.each(Object.entries(NOTES))('a note with %s, in the editor', (_name, text) => {
  it('is written back byte for byte when it is only opened and focused', () => {
    expect(open(text).save()).toBe(text);
  });

  it('keeps every other block’s bytes when one character is typed in one block', () => {
    const { note } = open(text);
    let edits = 0;
    note.parsed.blocks.forEach((edited, index) => {
      const { editor, save } = open(text);
      const at = firstTextIn(editor.state.doc, index);
      if (at === null) return;
      edits += 1;
      editor.view.dispatch(editor.state.tr.insertText('Z', at));
      const saved = save();
      expect(saved).not.toBe(text);
      for (const kept of note.parsed.blocks) {
        if (kept !== edited) expect(saved).toContain(kept.source);
      }
    });
    // Every note with words in it was edited somewhere, so the check above ran.
    expect(edits > 0).toBe(note.parsed.doc.content.some((block) => block.type !== 'rawBlock'));
  });
});

describe('saving a long note', () => {
  it('renders none of the blocks the editor holds as they were read, whatever the note', () => {
    for (const text of Object.values(NOTES)) {
      const { note, editor } = open(text);
      const renders: string[] = [];
      const render = blockRenderer(note.parsed, (node) => {
        renders.push(node.type);
        return '';
      });
      const read = (editor.getJSON() as EditorDocument).content.filter(
        (node) => node.attrs?.['blockId'] !== null && node.attrs?.['blockId'] !== undefined,
      );
      read.forEach(render);
      expect({ text, renders }).toEqual({ text, renders: [] });
    }
  });

  it('renders a block typed in once, not again on the next save', () => {
    const { note, editor } = open('First.\n\nSecond.\n');
    let renders = 0;
    const render = blockRenderer(note.parsed, () => {
      renders += 1;
      return 'written';
    });
    editor.view.dispatch(editor.state.tr.insertText('Z', 1));
    const [edited] = (editor.getJSON() as EditorDocument).content;
    render(edited!);
    render(structuredClone(edited!));
    expect(renders).toBe(1);
  });
});

describe('an aligned table', () => {
  const ALIGNED = NOTES['aligned table']!;

  it('keeps its bytes, alignment row and all, when the paragraph after it is edited', () => {
    const { editor, save } = open(ALIGNED);
    editor.commands.focus('end');
    editor.commands.insertContent(' More.');
    expect(save()).toBe(ALIGNED.replace('After the table.', 'After the table. More.'));
  });

  it('keeps each column’s alignment when one of its cells is edited', () => {
    const { editor, save } = open(ALIGNED);
    const cell = firstTextIn(editor.state.doc, 0);
    editor.view.dispatch(editor.state.tr.insertText('Z', cell!));
    const [, alignment] = save().split('\n');
    expect(
      alignment
        ?.split('|')
        .map((column) => column.trim())
        .filter(Boolean),
    ).toEqual([
      expect.stringMatching(/^:-+$/),
      expect.stringMatching(/^-+:$/),
      expect.stringMatching(/^:-+:$/),
    ]);
  });
});
