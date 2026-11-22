import type { MarkdownPort } from '../../application/index.ts';
import { joinFrontmatter, splitFrontmatter } from '../../domain/markdown/index.ts';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/** The remark-backed implementation of the application's markdown port. */
export const remarkMarkdown: MarkdownPort = {
  parseNote(text) {
    const { frontmatter, body } = splitFrontmatter(text);
    return { frontmatter, body, parsed: parseMarkdownBody(body) };
  },
  serializeNote({ frontmatter, body, parsed }, doc) {
    return joinFrontmatter(frontmatter, serializeMarkdownBody({ originalBody: body, parsed, doc }));
  },
};
