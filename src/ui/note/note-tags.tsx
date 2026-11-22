import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { tagHue } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { openInFor } from '../panes/open-in.ts';
import { useApp } from '../services.ts';
import { useVault } from '../state/vault-store.ts';

/**
 * The note's tags, as the pills they are in its text, on one line under
 * the title: read from the index, so they follow the text as it is saved
 * and the file as it changes on disk. Never part of the note. Nothing when
 * the note has no tags. A line too long for the page scrolls sideways,
 * faded at the edge where more pills wait.
 */
export function NoteTags({ path }: { path: VaultPath }) {
  const { services, actions } = useApp();
  const version = useVault((vault) => vault.version);
  const tags = useMemo(
    () => services.session.index.tagsOf(path),
    // `version` is the cue: the index answers afresh after any change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, path, version],
  );
  const row = useRef<HTMLElement>(null);
  const cut = useCutOff(row, tags);
  if (tags.length === 0) return null;

  return (
    <nav ref={row} className="note-tags" aria-label="Tags" data-cut={cut || undefined}>
      {tags.map((tag) => (
        <button
          key={tag.key}
          type="button"
          className="note-tags__pill"
          data-hue={tagHue(tag.name)}
          title={`Notes tagged #${tag.name}`}
          // Kept from the button, in a browser that focuses one on a press: the caret stays in the text.
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => actions.openTag(tag.name, openInFor(event))}
          onAuxClick={(event) => event.button === 1 && actions.openTag(tag.name, 'new-tab')}
        >
          #{tag.name}
        </button>
      ))}
    </nav>
  );
}

/** Whether the row runs on past its right edge, as it is scrolled and sized now. */
function useCutOff(row: RefObject<HTMLElement | null>, tags: readonly unknown[]): boolean {
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = row.current;
    if (element === null) return;
    const update = () => setCut(element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
    update();
    element.addEventListener('scroll', update, { passive: true });
    // jsdom has no ResizeObserver: there the row is measured on scroll alone.
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resized?.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      resized?.disconnect();
    };
  }, [row, tags]);
  return cut;
}
