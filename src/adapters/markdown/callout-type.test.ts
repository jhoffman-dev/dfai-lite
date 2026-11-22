import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from '../../domain/markdown/index.ts';
import { remarkMarkdown } from './remark-markdown.ts';

/**
 * A callout's type changed from its handle's menu: the note is saved with
 * only the `[!kind]` of that callout's first line rewritten, its title,
 * fold marker and body — and every other block — byte for byte.
 */

/** `text` opened, `edit` applied to each top-level callout, saved. */
function saved(text: string, edit: (node: EditorNode) => EditorNode): string {
  const note = remarkMarkdown.parseNote(text);
  const doc: EditorDocument = {
    type: 'doc',
    content: note.parsed.doc.content.map((node) => (node.type === 'callout' ? edit(node) : node)),
  };
  return remarkMarkdown.serializeNote(note, doc);
}

const retyped =
  (kind: string) =>
  (node: EditorNode): EditorNode => ({ ...node, attrs: { ...node.attrs, kind } });

const NOTE = [
  'Intro with *odd*   spacing and a [[Link]].',
  '',
  '>  [!NOTE]- A **folded** title [[Mara Quill]]',
  '>  * a star bullet',
  '>  * another one\\',
  '>    with a backslash break',
  '>',
  '>     indented code in the body',
  '',
  '',
  '> [!tip]',
  '> Untouched.',
  '',
].join('\n');

describe('a callout’s type changed', () => {
  it('rewrites only that callout’s first-line kind, keeping every other byte', () => {
    const out = saved(NOTE, (node) =>
      node.attrs?.['kind'] === 'NOTE' ? retyped('warning')(node) : node,
    );
    expect(out).toBe(NOTE.replace('[!NOTE]', '[!warning]'));
  });

  it('keeps a Windows note’s line endings', () => {
    const crlf = NOTE.replace(/\n/g, '\r\n');
    const out = saved(crlf, retyped('bug'));
    expect(out).toBe(crlf.replace('[!NOTE]', '[!bug]').replace('[!tip]', '[!bug]'));
  });

  it('saves a note untouched when the type is set to what it was, in the note’s casing', () => {
    expect(saved(NOTE, (node) => node)).toBe(NOTE);
  });

  it('keeps the note’s casing of a type when the body is edited', () => {
    const text = '> [!WARNING] Careful\n> body\n';
    const out = saved(text, (node) => ({
      ...node,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new body' }] }],
    }));
    expect(out).toBe('> [!WARNING] Careful\n> new body\n');
  });

  it('round-trips a type no one defines untouched', () => {
    const text = '> [!Larkspur-Decision]+ Ship it\n> On **Friday**.\n';
    const note = remarkMarkdown.parseNote(text);
    expect(note.parsed.doc.content[0]).toMatchObject({
      type: 'callout',
      attrs: { kind: 'Larkspur-Decision', title: 'Ship it', fold: '+' },
    });
    expect(remarkMarkdown.serializeNote(note, note.parsed.doc)).toBe(text);
    expect(saved(text, retyped('note'))).toBe('> [!note]+ Ship it\n> On **Friday**.\n');
  });

  it('writes the whole callout afresh when its type and its body both changed', () => {
    const text = '> [!note] Title\n> old\n';
    const out = saved(text, (node) => ({
      ...retyped('tip')(node),
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new' }] }],
    }));
    expect(out).toBe('> [!tip] Title\n> new\n');
  });
});
