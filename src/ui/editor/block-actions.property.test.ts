// @vitest-environment jsdom
/**
 * The handle's actions over generated notes, and its listeners over many
 * editors: lifted from DFAI's attack on them, without its highlights,
 * tombstones and `^id` anchors. Seeded, so a failure names the run that
 * shows it again. Fictional data only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { createEditorExtensions } from './extensions.ts';
import { BLOCK_ACTIONS, blockChange, blockTargetAt, type BlockTarget } from './block-actions.ts';
import { BlockHandle, runBlockAction } from './block-handle.ts';

const text = (words: string): JSONContent => ({ type: 'text', text: words });
const paragraph = (words: string): JSONContent => ({ type: 'paragraph', content: [text(words)] });
const cell = (...content: JSONContent[]): JSONContent => ({ type: 'tableCell', content });
const row = (...cells: JSONContent[]): JSONContent => ({ type: 'tableRow', content: cells });

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

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function noteOf(content: JSONContent[]): Editor {
  editor = new Editor({ extensions: extensions(), content: { type: 'doc', content } });
  return editor;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe('one action is one undo step', () => {
  it('is closed by the handle itself, whatever plugins the note has and in whatever order', () => {
    // The handle alone over a plain editor: no other plugin of the note's to
    // close the step for it, and nothing that fixes the order plugins run in.
    editor = new Editor({
      extensions: [StarterKit, BlockHandle],
      content: { type: 'doc', content: [paragraph('One.'), paragraph('Two.')] },
    });
    const target = blockTargetAt(editor.state.doc, { pos: 2, inside: -1 });
    if (target === null) throw new Error('No block.');
    expect(runBlockAction(editor.view, { target, action: 'addBelow' })).toBe(true);
    const added = editor.state.doc;
    editor.commands.insertContent('Typed.');
    editor.commands.undo();
    expect(editor.state.doc.eq(added)).toBe(true);
  });
});

/* ---- the property run ---- */

const SEED = 20261122;
const RUNS = 120;
const STEPS = 12;

function generatedNote(random: () => number): JSONContent[] {
  let serial = 0;
  const next = () => (serial += 1);
  const chance = (p: number) => random() < p;
  const words = () => `Words ${next()} of Tobias Fenn`;
  const para = (): JSONContent => paragraph(words());
  const listOf = (depth: number): JSONContent => {
    const type =
      depth === 0 && chance(0.3) ? 'taskList' : chance(0.3) ? 'orderedList' : 'bulletList';
    const itemType = type === 'taskList' ? 'taskItem' : 'listItem';
    const items = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
      type: itemType,
      ...(itemType === 'taskItem' && { attrs: { checked: chance(0.5) } }),
      content: [para(), ...(depth < 2 && chance(0.3) ? [listOf(depth + 1)] : [])],
    }));
    return { type, content: items };
  };
  const kinds: (() => JSONContent)[] = [
    para,
    () => ({ type: 'heading', attrs: { level: 2 }, content: [text(words())] }),
    () => listOf(0),
    () => ({ type: 'blockquote', content: [para(), ...(chance(0.5) ? [para()] : [])] }),
    () => ({ type: 'callout', attrs: { kind: 'note' }, content: [para()] }),
    () => ({
      type: 'table',
      content: [
        row(cell(paragraph(words())), cell(paragraph(words()))),
        row(cell(para()), cell(para())),
      ],
    }),
    () => ({
      type: 'paragraph',
      content: [
        text(`${words()}: `),
        { type: 'image', attrs: { src: `fern-${next()}.png`, alt: 'A fern' } },
      ],
    }),
    () => ({ type: 'rawBlock', attrs: { markdown: `<div class="larkspur">${next()}</div>` } }),
    () => ({ type: 'codeBlock', attrs: { language: null }, content: [text(`code ${next()}`)] }),
  ];
  return Array.from({ length: 1 + Math.floor(random() * 8) }, () =>
    kinds[Math.floor(random() * kinds.length)]!(),
  );
}

/** Every place a handle sits: each list item, and each block of the note. */
function handleTargets(doc: ProseMirrorNode): BlockTarget[] {
  const targets: BlockTarget[] = [];
  doc.descendants((node, pos, parent) => {
    const isItem = node.type.name === 'listItem' || node.type.name === 'taskItem';
    if (isItem || parent === doc) targets.push({ pos, node });
    return !node.isTextblock && !node.isAtom;
  });
  return targets;
}

/** Each raw block's source, sorted: the blocks the editor does not model. */
const rawSourcesIn = (doc: ProseMirrorNode): string[] => {
  const found: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'rawBlock') found.push(String(node.attrs['markdown']));
    return true;
  });
  return found.sort();
};

/** Whether the person has somewhere to put the caret: a textblock in the note. */
function hasTextblock(doc: ProseMirrorNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.isTextblock) found = true;
    return !found;
  });
  return found;
}

/** The blocks of `before` the action did not touch, in order, are still in `after`, unchanged. */
function untouchedKept(
  before: ProseMirrorNode,
  after: ProseMirrorNode,
  touchedIndex: number,
): boolean {
  const kept: ProseMirrorNode[] = [];
  before.forEach((node, _offset, index) => {
    if (index !== touchedIndex) kept.push(node);
  });
  let at = 0;
  after.forEach((node) => {
    if (at < kept.length && node.eq(kept[at]!)) at += 1;
  });
  return at === kept.length;
}

/** What one action on `target` may have broken, in words; empty when nothing. */
function brokenBy(
  {
    before,
    after,
    target,
  }: { before: ProseMirrorNode; after: ProseMirrorNode; target: BlockTarget },
  action: (typeof BLOCK_ACTIONS)[number],
): string[] {
  const broken: string[] = [];
  if (!hasTextblock(after)) broken.push('no block left to type in');
  const touched = before.resolve(target.pos).index(0);
  if (!untouchedKept(before, after, touched)) broken.push('a block it did not act on changed');
  const raws = (doc: ProseMirrorNode) => JSON.stringify(rawSourcesIn(doc));
  const lostRaw = action !== 'delete' && action !== 'duplicate' && raws(after) !== raws(before);
  if (lostRaw) broken.push('a raw block was lost or changed');
  return broken;
}

describe('every handle action over generated notes', () => {
  it('keeps every raw block, undo exact, untouched blocks unchanged', () => {
    const random = mulberry32(SEED);
    const failures: string[] = [];
    for (let run = 0; run < RUNS && failures.length < 8; run += 1) {
      const instance = noteOf(generatedNote(random));
      // The editor's own fix-ups (a trailing paragraph after a table) land on the first
      // transaction; let them land, unrecorded, so "before" is the note as the person sees it.
      instance.view.dispatch(instance.state.tr.setMeta('addToHistory', false));
      for (let step = 0; step < STEPS; step += 1) {
        const targets = handleTargets(instance.state.doc);
        if (targets.length === 0) break;
        const target = targets[Math.floor(random() * targets.length)]!;
        const action = BLOCK_ACTIONS[Math.floor(random() * BLOCK_ACTIONS.length)]!;
        const before = instance.state.doc;
        const change = blockChange(instance.state, { target, action });
        if (change === null) continue;
        instance.view.dispatch(change);
        const where = `seed ${SEED} run ${run} step ${step}: ${action} on ${target.node.type.name} at ${target.pos}`;
        const after = instance.state.doc;
        for (const broken of brokenBy({ before, after, target }, action)) {
          failures.push(`${where}: ${broken}`);
        }
        if (random() < 0.4) {
          instance.commands.undo();
          if (!instance.state.doc.eq(before))
            failures.push(`${where}: undo is not the note before`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);
});

describe('closing many notes', () => {
  it('leaves no pointer listener of a handle on the page after 20 editors are destroyed', () => {
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    try {
      const made = Array.from(
        { length: 20 },
        () =>
          new Editor({
            extensions: extensions(),
            content: { type: 'doc', content: [paragraph('Fern.')] },
          }),
      );
      for (const each of made) each.destroy();
      const moves = (spy: typeof added) =>
        spy.mock.calls.filter(([type]) => type === 'mousemove').map(([, listener]) => listener);
      expect(moves(added).length).toBeGreaterThanOrEqual(20);
      expect(moves(added).filter((listener) => !moves(removed).includes(listener))).toEqual([]);
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });
});
