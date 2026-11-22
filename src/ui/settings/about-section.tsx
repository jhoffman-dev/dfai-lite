import { useState } from 'react';

/** Which build this is: handed down by the composition root, which reads what the build stamped. */
export interface BuildInfo {
  readonly version: string;
  /** The short commit; `+` after it when built from uncommitted changes; `dev` when unknown. */
  readonly commit: string;
}

/** What Copy puts on the clipboard, for a bug report: `DFAI Lite 0.2.0 (abc1234)`. */
export function buildLine(build: BuildInfo): string {
  return `DFAI Lite ${build.version} (${build.commit})`;
}

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_LABEL: Record<CopyState, string> = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Could not copy',
};

/** The version and the commit it was built from, with a Copy for pasting into a bug report. */
export function AboutSection({
  build,
  copyText = (text) => navigator.clipboard.writeText(text),
}: {
  build: BuildInfo;
  copyText?: (text: string) => Promise<void>;
}) {
  const [copy, setCopy] = useState<CopyState>('idle');
  const onCopy = () => {
    copyText(buildLine(build)).then(
      () => setCopy('copied'),
      () => setCopy('failed'),
    );
  };
  return (
    <section className="settings__section" aria-labelledby="about-heading">
      <h3 id="about-heading" className="settings__heading">
        About
      </h3>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label" data-testid="about-version">
            DFAI Lite {build.version}
          </span>
          <span className="settings__status" data-testid="about-commit">
            Built from {build.commit}
          </span>
        </span>
        <button type="button" className="btn btn--secondary" aria-live="polite" onClick={onCopy}>
          {COPY_LABEL[copy]}
        </button>
      </div>
    </section>
  );
}
