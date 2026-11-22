import type { MarkdownPort } from '../application/index.ts';
import type { LoadMarkdown } from '../ui/services.ts';

/**
 * A loader that fetches the markdown port once and hands back the same
 * promise every time: the note view suspends on it, and a new promise per
 * render would suspend it forever. A fetch that failed (a dropped chunk, an
 * app updated underneath) stays failed, so the view shows why rather than
 * fetching in a loop, until it is asked for `afresh`.
 */
export function createMarkdownLoader(fetchPort: () => Promise<MarkdownPort>): LoadMarkdown {
  let loading: Promise<MarkdownPort> | null = null;
  let failed = false;
  return ({ afresh = false } = {}) => {
    if (loading === null || (afresh && failed)) {
      failed = false;
      loading = fetchPort();
      loading.catch(() => {
        failed = true;
      });
    }
    return loading;
  };
}
