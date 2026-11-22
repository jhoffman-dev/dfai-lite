import { Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * A block of markdown the editor does not model — raw HTML, a footnote, a
 * link definition, a math block. It is an atom: shown as its source and
 * carried through a save untouched, so an unsupported construct is never
 * approximated and quietly rewritten.
 */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      // Read only from `data-markdown`, by the parse rule: a bare `markdown`
      // attribute, which Tiptap would read by default, is not the app's.
      markdown: { default: '', parseHTML: () => null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'pre[data-raw-block]',
        // Above the code block's `pre` rule (priority 50), which would otherwise
        // take a pasted raw block and save its source as a fenced block.
        priority: 60,
        // The source is read from its attribute, not the element's text.
        // Without one, the rule passes and the code block keeps the text.
        getAttrs: (element) => {
          const markdown = sourceFromAttribute(element.getAttribute('data-markdown'));
          return markdown === null ? false : { markdown };
        },
      },
    ];
  },

  // A paste into another app gets the source: a raw block has no text of its own.
  renderText({ node }) {
    return String(node.attrs['markdown'] ?? '');
  },

  renderHTML({ node }) {
    return rawBlockSpec(node);
  },
});

/** The block's source, as a `pre`. */
function rawBlockSpec(node: ProseMirrorNode) {
  const markdown = String(node.attrs['markdown'] ?? '');
  const attributes = {
    'data-raw-block': '',
    // Percent-encoded: serializers leave `<` bare in an attribute, which
    // would put the source's tags into the HTML of a copy of the note.
    'data-markdown': encodeURIComponent(markdown),
    class: isComment(markdown) ? 'raw-block raw-block--comment' : 'raw-block',
    title: 'Not editable here — saved unchanged',
  };
  return ['pre', attributes, markdown] as const;
}

/** The source `data-markdown` holds, or null without one or with one the app did not write. */
const sourceFromAttribute = (encoded: string | null): string | null => {
  if (encoded === null) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    // Not percent-encoding, so not ours: the code block's rule reads it instead.
    return null;
  }
};

/**
 * Whether a raw block is one HTML comment and nothing else, which nobody
 * reads: it is drawn small and muted rather than as a block of source.
 */
const isComment = (markdown: string): boolean =>
  /^<!--(?:(?!-->)[\s\S])*-->$/.test(markdown.trim());
