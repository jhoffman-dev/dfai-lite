import { lazy, Suspense, useMemo } from 'react';
import { useApp } from '../services.ts';
import { PageBar, type PageHistory } from '../shell/page-bar.tsx';
import { useVault } from '../state/vault-store.ts';
import './graph-page.css';

// d3 loads with the graph, not with the first paint.
const GraphView = lazy(() => import('../graph/index.ts'));

/** The vault's links as a graph; clicking a note opens it. */
export function GraphPage({
  activePath,
  history,
}: {
  activePath: string | null;
  history: PageHistory;
}) {
  const { services, actions } = useApp();
  const version = useVault((vault) => vault.version);
  const graph = useMemo(
    () => services.session.index.graph(),
    // `version` is the cue to ask the index again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, version],
  );
  return (
    <div className="graph-page">
      <PageBar history={history} icon="graph" place={null} name="Graph" />
      <Suspense fallback={<p className="graph-page__loading">Loading the graph…</p>}>
        <GraphView
          graph={graph}
          activePath={activePath}
          onOpenNote={actions.openNote}
          onFollowLink={(target, openIn) =>
            actions.followLink(target, openIn).catch(actions.report)
          }
        />
      </Suspense>
    </div>
  );
}
