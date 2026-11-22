import { useMemo } from 'react';
import { noteTitle } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { useApp } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { useVault } from '../state/vault-store.ts';

/** The notes that link here, as DFAI's linked mentions: hairline rows under the note. Nothing when there are none. */
export function Backlinks({ path }: { path: VaultPath }) {
  const { services } = useApp();
  const version = useVault((vault) => vault.version);
  const sources = useMemo(
    () => services.session.index.backlinks(path),
    // `version` is the cue: the index answers afresh after any change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, path, version],
  );
  if (sources.length === 0) return null;

  return (
    <section className="mentions" aria-labelledby="backlinks-heading">
      <h2 id="backlinks-heading" className="mentions__heading">
        Linked from
      </h2>
      <ul className="mentions__list">
        {sources.map((source) => (
          <li key={source}>
            <a className="mentions__link" href={`#/note/${encodeURIComponent(source)}`}>
              <Icon name="doc" size={15} />
              <span className="mentions__title">{noteTitle(source)}</span>
              <span className="mentions__path">{services.session.index.summary(source)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
