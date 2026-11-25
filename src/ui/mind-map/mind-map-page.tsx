import { useMemo, useState, type MouseEvent } from 'react';
import {
  buildMindMap,
  DEFAULT_MAP_OPTIONS,
  EMPTY_MAP_VIEW,
  entitiesTo,
  entityKey,
  focusTrail,
  layoutMindMap,
  rootOf,
  sameRoot,
  showMore,
  toggleNode,
  trailAt,
} from '../../application/index.ts';
import type {
  MapEntity,
  MapNode,
  MapRoot,
  MapTrail,
  MapView,
} from '../../domain/mind-map/index.ts';
import type { OpenIn } from '../panes/layout.ts';
import { openInFor } from '../panes/open-in.ts';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { PageBar, type PageHistory } from '../shell/page-bar.tsx';
import { useVault } from '../state/vault-store.ts';
import { mapTitle, rootTitle } from '../tabs/tab-bar.tsx';
import { MapCanvas } from './map-canvas.tsx';
import {
  keepTrail,
  keepTranscripts,
  keepView,
  keptTrail,
  keptTranscripts,
  keptView,
} from './map-memory.ts';
import './mind-map.css';

/**
 * A mind map in a tab: from the note or tag the tab names, or from the open
 * note when it follows. Re-rooting is a step in the tab's own history, so
 * Back returns; the trail above the map is the way walked.
 */
export function MindMapPage({
  tabId,
  root,
  followed,
  history,
}: {
  tabId: string;
  /** The tab's root; null when it follows the open note. */
  root: MapRoot | null;
  /** The note open beside it, for a map that follows. */
  followed: string | null;
  history: PageHistory;
}) {
  const { actions } = useApp();
  const shown: MapRoot | null =
    root ?? (followed === null ? null : { kind: 'note', path: followed });
  const trail = shown === null ? null : trailAt(keptTrail(tabId), shown);
  if (trail !== null) keepTrail(tabId, trail);
  const open = (next: MapRoot | null) => actions.openMap(next, 'active');
  const [transcripts, setTranscripts] = useState(() => keptTranscripts(tabId));

  return (
    <div className="mind-map-page">
      <PageBar history={history} icon="mind-map" place={null} name={mapTitle(root)}>
        <div className="page-bar__actions">
          <button
            type="button"
            className="btn btn--ghost page-bar__action"
            aria-pressed={root === null}
            title="Follow the open note: the map re-roots on whichever note is open"
            onClick={() => open(root === null ? shown : null)}
          >
            <Icon name="link" size={15} />
            <span className="page-bar__action-label">Follow open note</span>
          </button>
          <button
            type="button"
            className="btn btn--ghost page-bar__action"
            aria-pressed={transcripts}
            title="Meeting transcripts are left off the map unless shown"
            onClick={() => {
              keepTranscripts(tabId, !transcripts);
              setTranscripts(!transcripts);
            }}
          >
            <Icon name="doc" size={15} />
            <span className="page-bar__action-label">Transcripts</span>
          </button>
        </div>
      </PageBar>
      {shown === null || trail === null ? (
        <p className="mind-map__empty">Open a note, and the map follows it.</p>
      ) : (
        <MindMapBody
          key={entityKey(shown)}
          tabId={tabId}
          root={shown}
          trail={trail}
          transcripts={transcripts}
          onReroot={(next, way) => {
            keepTrail(tabId, focusTrail(trail, way));
            open(next);
          }}
          onCrumb={open}
        />
      )}
    </div>
  );
}

/** The map from one root, opened as far as the tab left it. */
function useMap(tabId: string, root: MapRoot, transcripts: boolean) {
  const { services } = useApp();
  const version = useVault((vault) => vault.version);
  const key = entityKey(root);
  const [view, setViewState] = useState<MapView>(() => keptView(tabId, key) ?? EMPTY_MAP_VIEW);
  const tree = useMemo(
    () => buildMindMap(services.session.index, root, view, { ...DEFAULT_MAP_OPTIONS, transcripts }),
    // `version` is the cue to ask the index again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, root, view, transcripts, version],
  );
  const layout = useMemo(() => (tree === null ? null : layoutMindMap(tree)), [tree]);
  return {
    layout,
    view,
    setView(next: MapView) {
      keepView(tabId, key, next);
      setViewState(next);
    },
  };
}

function MindMapBody({
  tabId,
  root,
  trail,
  transcripts,
  onReroot,
  onCrumb,
}: {
  tabId: string;
  root: MapRoot;
  trail: MapTrail;
  transcripts: boolean;
  onReroot: (root: MapRoot, way: readonly MapEntity[]) => void;
  onCrumb: (root: MapRoot) => void;
}) {
  const { actions } = useApp();
  const looks = useVault((vault) => vault.appearances);
  const { layout, view, setView } = useMap(tabId, root, transcripts);
  if (layout === null) return <p className="mind-map__empty">{goneText(root)}</p>;

  const press = (node: MapNode, openIn: OpenIn) => {
    if (node.item.kind === 'branch') setView(toggleNode(view, node));
    else if (node.item.kind === 'more') setView(showMore(view, node.id, DEFAULT_MAP_OPTIONS.cap));
    else openEntity(actions, node.item.entity, openIn);
  };
  const focusRoot = (node: MapNode) => {
    const next = node.item.kind === 'entity' ? rootOf(node.item.entity) : null;
    if (next !== null && !sameRoot(next, root)) onReroot(next, entitiesTo(layout.nodes, node.id));
  };

  return (
    <>
      <Trail trail={trail} onCrumb={onCrumb} />
      <MapCanvas
        layout={layout}
        looks={looks}
        onEnter={(node) => press(node, 'other-pane')}
        handlers={{
          onPress: (node, event: MouseEvent) => press(node, besideUnlessAsked(openInFor(event))),
          onFocusRoot: focusRoot,
          onToggle: (node) => setView(toggleNode(view, node)),
        }}
      />
    </>
  );
}

function goneText(root: MapRoot): string {
  return root.kind === 'note'
    ? `There is no note at ${root.path}.`
    : `No note is tagged #${root.key}.`;
}

function openEntity(
  actions: ReturnType<typeof useApp>['actions'],
  entity: MapEntity,
  openIn: OpenIn,
) {
  if (entity.kind === 'note') actions.openNote(entity.path, openIn);
  else if (entity.kind === 'tag') actions.openTag(entity.name, openIn);
  else actions.followLink(entity.target, openIn).catch(actions.report);
}

/** A plain click opens in the other pane, so the map stays to walk on; ⌘ and ⌥ keep their meaning. */
function besideUnlessAsked(openIn: OpenIn): OpenIn {
  return openIn === 'active' ? 'other-pane' : openIn;
}

function Trail({ trail, onCrumb }: { trail: MapTrail; onCrumb: (root: MapRoot) => void }) {
  if (trail.roots.length < 2) return null;
  return (
    <nav className="mind-map__trail" aria-label="Map trail">
      <span className="mind-map__trail-label">Trail</span>
      {trail.roots.map((root, index) => (
        <span key={`${index}:${entityKey(root)}`} className="mind-map__crumb">
          {index > 0 ? <span aria-hidden="true">›</span> : null}
          <button
            type="button"
            aria-current={index === trail.at ? 'location' : undefined}
            onClick={() => onCrumb(root)}
          >
            {rootTitle(root)}
          </button>
        </span>
      ))}
    </nav>
  );
}
