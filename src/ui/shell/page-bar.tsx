import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';
import { keyFor } from './shortcuts.ts';
import { useKeyHost } from './use-shortcuts.ts';
import './page-bar.css';

/**
 * Back and Forward for the tab a bar sits on, as DFAI's. Each names where it
 * goes, so its tooltip can say so; null when there is nowhere to go, which
 * disables it.
 */
export interface PageHistory {
  readonly back: string | null;
  readonly forward: string | null;
  readonly onBack: () => void;
  readonly onForward: () => void;
}

/**
 * A page's 40px nav bar, as DFAI heads every page: Back and Forward, the
 * breadcrumb (an icon, where the page lives, its name, what it holds), then
 * the page's own buttons at the row's end.
 */
export function PageBar({
  history,
  icon,
  place,
  name,
  count,
  children,
}: {
  history?: PageHistory;
  icon: IconName;
  place: string | null;
  name: string;
  count?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-bar">
      <div className="page-bar__row">
        {history === undefined ? null : <HistoryButtons history={history} />}
        <span className="page-bar__crumbs">
          <Icon name={icon} size={15} />
          {place === null ? null : (
            <>
              <span className="page-bar__parent">{place}</span>
              <span aria-hidden="true">/</span>
            </>
          )}
          <span className="page-bar__name">{name}</span>
          {count === undefined ? null : <span className="page-bar__count">{count}</span>}
        </span>
        <span className="page-bar__spacer" />
        {children}
      </div>
    </div>
  );
}

function HistoryButtons({ history }: { history: PageHistory }) {
  const host = useKeyHost();
  return (
    <div className="page-bar__history" role="group" aria-label="History">
      <HistoryButton
        label="Back"
        icon="arrow-left"
        destination={history.back}
        shortcut={keyFor('history.back', host)}
        onGo={history.onBack}
      />
      <HistoryButton
        label="Forward"
        icon="arrow-right"
        destination={history.forward}
        shortcut={keyFor('history.forward', host)}
        onGo={history.onForward}
      />
    </div>
  );
}

function HistoryButton({
  label,
  icon,
  destination,
  shortcut,
  onGo,
}: {
  label: 'Back' | 'Forward';
  icon: 'arrow-left' | 'arrow-right';
  destination: string | null;
  shortcut: string;
  onGo: () => void;
}) {
  return (
    <button
      className="icon-button page-bar__button"
      type="button"
      onClick={onGo}
      disabled={destination === null}
      aria-label={label}
      title={destination === null ? label : `${label} to ${destination} (${shortcut})`}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}
