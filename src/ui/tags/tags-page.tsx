import { useMemo } from 'react';
import { folderOf, noteTitle, tagHue } from '../../application/index.ts';
import type { TagTreeNode } from '../../domain/tags/index.ts';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { PageBar, type PageHistory } from '../shell/page-bar.tsx';
import { useVault } from '../state/vault-store.ts';
import './tags.css';

const tagHref = (key: string) => `#/tags/${encodeURIComponent(key)}`;

/** One level of the tag tree, as DFAI's tags page draws it: 34px rows, each tag on its pastel. */
function TagBranch({
  nodes,
  selected,
  depth = 0,
}: {
  nodes: readonly TagTreeNode[];
  selected: string | null;
  depth?: number;
}) {
  return (
    <ul className={depth === 0 ? 'tags__tree' : 'tags__children'}>
      {nodes.map((node) => (
        <li key={node.key} className={node.key === selected ? 'tags__item--on' : undefined}>
          <a
            className="tags__row"
            href={tagHref(node.key)}
            aria-current={node.key === selected ? 'page' : undefined}
            // A nested tag steps in under its parent.
            style={{ paddingLeft: 12 + depth * 18 }}
          >
            <span className="tags__icon">
              <Icon name="tag" size={15} />
            </span>
            <span className="tags__name">
              <span className="tags__pill" data-hue={tagHue(node.key)}>
                {node.label}
              </span>
            </span>
            {node.total > 0 ? <span className="tags__count">{node.total}</span> : null}
          </a>
          {node.children.length > 0 ? (
            <TagBranch nodes={node.children} selected={selected} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TaggedNotes({ tag }: { tag: string }) {
  const { services, actions } = useApp();
  const version = useVault((vault) => vault.version);
  const notes = useMemo(
    () => services.session.index.notesWithTag(tag),
    // `version` is the cue to ask the index again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, tag, version],
  );
  return (
    <section className="tags__detail" aria-labelledby="tagged-heading">
      <header className="tags__detail-head">
        <h2 id="tagged-heading" className="tags__title">
          <span className="tags__pill" data-hue={tagHue(tag)}>
            {tag}
          </span>
        </h2>
        <span className="tags__uses">
          {notes.length === 1 ? '1 note' : `${notes.length} notes`}
        </span>
        <button
          type="button"
          className="btn btn--ghost tags__map"
          title={`Open a mind map of #${tag} beside this list`}
          onClick={() => actions.openMap({ kind: 'tag', key: tag })}
        >
          <Icon name="mind-map" size={15} />
          Mind map
        </button>
      </header>
      <ul className="tags__notes" aria-label={`Notes tagged ${tag}`}>
        {notes.map((path) => (
          <li key={path}>
            <a className="tags__note" href={`#/note/${encodeURIComponent(path)}`}>
              <span className="tags__icon">
                <Icon name="doc" size={15} />
              </span>
              <span className="tags__note-title">{noteTitle(path)}</span>
              <span className="tags__count">{folderOf(path)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every tag in the vault as a tree with counts; choosing one lists its notes, nested tags included. */
export function TagsPage({ tag, history }: { tag: string | null; history: PageHistory }) {
  const { services } = useApp();
  const version = useVault((vault) => vault.version);
  const tree = useMemo(
    () => services.session.index.tagTree(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, version],
  );

  return (
    <div className="tags-page">
      <PageBar
        history={history}
        icon="tag"
        place="Tags"
        name={tag === null ? 'All tags' : `#${tag}`}
      />
      <div className="tags">
        <div className="tags__columns">
          <nav aria-label="Tags" className="tags__index">
            {tree.length === 0 ? (
              <p className="tags__hint">No tags yet. Type #idea in a note to make one.</p>
            ) : (
              <TagBranch nodes={tree} selected={tag} />
            )}
          </nav>
          {tag === null ? (
            <div className="tags__detail">
              <p className="tags__hint">Choose a tag to see the notes that use it.</p>
            </div>
          ) : (
            <TaggedNotes tag={tag} />
          )}
        </div>
      </div>
    </div>
  );
}
