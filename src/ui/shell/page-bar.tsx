import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';
import './page-bar.css';

/**
 * A page's 40px nav bar, as DFAI heads every page: the breadcrumb (an icon,
 * where the page lives, its name, what it holds), then the page's own
 * buttons at the row's end.
 */
export function PageBar({
  icon,
  place,
  name,
  count,
  children,
}: {
  icon: IconName;
  place: string | null;
  name: string;
  count?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-bar">
      <div className="page-bar__row">
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
