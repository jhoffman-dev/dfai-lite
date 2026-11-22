import { Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import { calloutLabel, resolveCallout } from '../../application/index.ts';
import type { CalloutSettings } from '../../domain/callouts/index.ts';
import { glyphElement } from '../shell/glyphs.ts';
import '../shell/callout.css';

/** The vault's callout types as the editor reads them: now, and when they change. */
export interface CalloutCatalog {
  settings(): CalloutSettings;
  /** Hears the types change (a type added in Settings, the file pulled); returns the way to stop. */
  watch(listener: () => void): () => void;
}

/** The built-ins alone: an editor with no vault behind it (a test). */
const BUILT_INS_ONLY: CalloutCatalog = {
  settings: () => ({ types: [], hidden: [] }),
  watch: () => () => undefined,
};

const markerOf = (node: ProseMirrorNode) => ({
  kind: String(node.attrs['kind'] ?? 'note'),
  title: (node.attrs['title'] as string | null) ?? null,
  fold: (node.attrs['fold'] as string | null) ?? null,
});

/**
 * An Obsidian callout. The marker line is held in attributes and drawn as a
 * non-editable header, so the body can be edited freely without the risk of
 * breaking the `[!note]` that makes it a callout. The header's badge and
 * hue come from the callout's type — a built-in, the vault's own, or the
 * fallback for one nobody defines — and are drawn, never written: the note
 * holds the type's name and nothing else.
 */
export const Callout = Node.create<{ catalog: CalloutCatalog }>({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { catalog: BUILT_INS_ONLY };
  },

  addAttributes() {
    return {
      kind: { default: 'note' },
      title: { default: null },
      fold: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  // What a copy carries as HTML; the editor draws a callout with its view.
  renderHTML({ node }) {
    const resolved = resolveCallout(markerOf(node).kind, this.options.catalog.settings());
    return [
      'div',
      { class: 'callout', 'data-callout': resolved.key, 'data-hue': resolved.hue },
      [
        'div',
        { class: 'callout__title', contenteditable: 'false' },
        headerLabel(node, this.options.catalog),
      ],
      ['div', { class: 'callout__body' }, 0],
    ];
  },

  addNodeView() {
    const { catalog } = this.options;
    return ({ node }) => new CalloutView(node, catalog);
  },
});

function headerLabel(node: ProseMirrorNode, catalog: CalloutCatalog): string {
  const marker = markerOf(node);
  return marker.title !== null
    ? calloutLabel(marker)
    : resolveCallout(marker.kind, catalog.settings()).label;
}

/** A callout drawn: its header redrawn when its type or the vault's types change. */
class CalloutView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly header: HTMLElement;
  private readonly stopWatching: () => void;
  private node: ProseMirrorNode;
  private readonly catalog: CalloutCatalog;

  constructor(node: ProseMirrorNode, catalog: CalloutCatalog) {
    this.node = node;
    this.catalog = catalog;
    this.dom = document.createElement('div');
    this.dom.className = 'callout';
    this.header = document.createElement('div');
    this.header.className = 'callout__title';
    this.header.contentEditable = 'false';
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'callout__body';
    this.dom.append(this.header, this.contentDOM);
    this.draw();
    this.stopWatching = catalog.watch(() => this.draw());
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    const redraw = node.attrs !== this.node.attrs;
    this.node = node;
    if (redraw) this.draw();
    return true;
  }

  /** The header is drawn here, not typed in: what changes in it is no edit of the note. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.stopWatching();
  }

  private draw(): void {
    const resolved = resolveCallout(markerOf(this.node).kind, this.catalog.settings());
    this.dom.dataset['callout'] = resolved.key;
    this.dom.dataset['hue'] = resolved.hue;
    this.dom.dataset['calloutSource'] = resolved.source;
    const badge = document.createElement('span');
    badge.className = 'callout__badge';
    badge.append(glyphElement(resolved.icon, 15));
    const label = document.createElement('span');
    label.className = 'callout__label';
    label.textContent = headerLabel(this.node, this.catalog);
    this.header.replaceChildren(badge, label);
  }
}
