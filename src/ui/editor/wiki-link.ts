import { InputRule, mergeAttributes, Node } from '@tiptap/core';
import { splitWikiLinks, wikiLinkLabel } from '../../application/index.ts';
import { linkAttributes } from './link-attributes.ts';

/** A `[[link]]` just closed, `!` and all for an embed, at the caret. */
const CLOSED_LINK = /!?\[\[[^[\]\n]+\]\]$/;

/**
 * `[[Another Note]]` as a single inline atom: it is selected and deleted as one
 * thing, and its brackets cannot be half-edited into something that no longer parses.
 */
export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      ...linkAttributes('data-wikilink'),
      // `![[…]]`: written back with its `!`, which as text would be escaped.
      embed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-embed') === 'true',
        renderHTML: (attrs) => (attrs['embed'] === true ? { 'data-embed': 'true' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-wikilink]' }];
  },

  /**
   * A link typed out in full, `]]` and all, rather than picked from the
   * list, becomes the link it reads as, as Obsidian's does. Left as text, its
   * brackets would be written escaped (`\[\[Note]]`) and it would link nowhere.
   */
  addInputRules() {
    return [
      new InputRule({
        find: CLOSED_LINK,
        handler: ({ state, range, match }) => {
          const [piece, ...more] = splitWikiLinks(match[0]);
          if (piece?.kind !== 'wikiLink' || more.length > 0) return null;
          const { target, heading, alias, embed } = piece;
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ target, heading, alias, embed: embed === true }),
          );
        },
      }),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'wikilink',
        // No href: following it is the app's job, not the webview's.
        role: 'link',
        tabindex: '0',
      }),
      wikiLinkLabel({
        target: String(node.attrs['target'] ?? ''),
        heading: (node.attrs['heading'] as string | null) ?? null,
        alias: (node.attrs['alias'] as string | null) ?? null,
      }),
    ];
  },
});
