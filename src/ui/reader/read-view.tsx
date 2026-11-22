import { useMemo, type MouseEvent } from 'react';
import type { OpenIn } from '../panes/layout.ts';
import { openInFor } from '../panes/open-in.ts';
import { renderMarkdown } from './render-markdown.ts';
import './reader.css';

/**
 * The note rendered: markdown-it, then DOMPurify, always. Wiki links and
 * tags are live; a task's checkbox shows its state but does not edit it.
 */
export default function ReadView({
  text,
  resolves,
  onFollowLink,
}: {
  text: string;
  resolves: (target: string) => boolean;
  onFollowLink: (target: string, openIn: OpenIn) => void;
}) {
  const html = useMemo(() => renderMarkdown(text, { resolves }), [text, resolves]);

  const onClick = (event: MouseEvent) => {
    const link = (event.target as HTMLElement).closest<HTMLElement>('[data-wikilink]');
    if (link === null || event.button > 1) return;
    event.preventDefault();
    onFollowLink(link.dataset['wikilink'] ?? '', openInFor(event));
  };

  return (
    // Clicks are delegated: the links are in HTML the renderer made, not in React.
    // They are real anchors, so Enter on one clicks it too.
    <article
      className="read-view"
      aria-label="Rendered note"
      onClick={onClick}
      onAuxClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
