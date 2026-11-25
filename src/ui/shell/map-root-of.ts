import type { MapRoot } from '../../domain/mind-map/index.ts';
import type { TabView } from '../panes/layout.ts';

/**
 * What a mind map opened from a tab is drawn from: its note, its tag, the
 * same root as a map tab already shows, or null (follow the open note).
 */
export function mapRootOf(view: TabView): MapRoot | null {
  switch (view.kind) {
    case 'note':
      return { kind: 'note', path: view.path };
    case 'tags':
      return view.tag === null ? null : { kind: 'tag', key: view.tag };
    case 'map':
      return view.root;
    case 'graph':
    case 'home':
      return null;
  }
}
