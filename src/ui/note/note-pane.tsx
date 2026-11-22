import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createNoteFromLink, noteTitle, rankNoteSuggestions } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import type { EditorBridge } from '../editor/bridge.ts';
import type { Tab } from '../panes/layout.ts';
import type { TabMemory } from '../panes/workspace.ts';
import { useApp, type AppContextValue } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { useUi } from '../state/ui-store.ts';
import { useVault } from '../state/vault-store.ts';
import type { Autosave } from './autosave.ts';
import { Backlinks } from './backlinks.tsx';
import type { OpenNote } from './open-notes.ts';
import { NoteTitle } from './note-title.tsx';
import './note.css';

// markdown-it and DOMPurify load the first time a note is read, not at start.
const ReadView = lazy(() => import('../reader/read-view.tsx'));

/**
 * CodeMirror is most of the app's weight, so it loads after the first paint:
 * `preloadEditor` starts it at once, and until it lands the note's text shows as it is.
 */
export const preloadEditor = () => import('../editor/note-editor.tsx');
const NoteEditor = lazy(() => preloadEditor().then(({ NoteEditor }) => ({ default: NoteEditor })));

const TAG_SUGGESTIONS = 12;

function editorBridge(app: AppContextValue, { saver, mirror }: OpenNote): EditorBridge {
  const { services, actions, deps } = app;
  const { autosave, opened } = saver;
  const index = services.session.index;
  const resolve = (target: string) => index.resolve(target);
  return {
    suggestNotes: (query) => rankNoteSuggestions({ query, notes: index.paths(), resolve }),
    suggestTags: (prefix) => {
      const wanted = prefix.toLowerCase();
      return index
        .tagCounts()
        .filter((tag) => tag.key.startsWith(wanted))
        .sort((left, right) => right.count - left.count)
        .slice(0, TAG_SUGGESTIONS)
        .map((tag) => tag.name);
    },
    resolves: (target) => resolve(target) !== null,
    createLinkedNote: (target) => {
      createNoteFromLink(deps, { target }).catch(actions.report);
    },
    followLink: (target, openIn) => {
      autosave
        .flush()
        .then(() => actions.followLink(target, openIn))
        .catch(actions.report);
    },
    openTag: (name, openIn) => actions.openTag(name, openIn),
    opened,
    changed: (read) => autosave.schedule(read),
    blurred: () => void autosave.flush(),
    closed: () => {
      autosave.flush().then(mirror.settled, actions.report);
    },
  };
}

/** Saves what is waiting when the page is hidden or closed, and when the note is left. */
function useFlushOnLeave(autosave: Autosave): void {
  useEffect(() => {
    const flush = () => void autosave.flush();
    const onHidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, [autosave]);
}

function FavoriteToggle({ path }: { path: VaultPath }) {
  const { actions } = useApp();
  const isFavorite = useVault((vault) => vault.favorites.includes(path));
  return (
    <button
      type="button"
      className={`quiet-button note-star${isFavorite ? ' is-on' : ''}`}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
      title={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
      onClick={() => actions.toggleFavorite(path).catch(actions.report)}
    >
      <Icon name="star" filled={isFavorite} />
    </button>
  );
}

/** Puts the tab's scroll back where it was left, and keeps it when the tab is hidden. */
function useKeptScroll(memory: TabMemory) {
  const article = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const scroller = article.current?.closest<HTMLElement>('[role="tabpanel"]') ?? null;
    if (scroller === null) return;
    scroller.scrollTop = memory.scrollTop;
    return () => {
      memory.scrollTop = scroller.scrollTop;
    };
  }, [memory]);
  return article;
}

/**
 * One note in one tab: its title, the editor or the rendered view, and what
 * links here. Keyed by tab and path. `focused`: the tab is the active pane's.
 */
export function NotePane({ tab, path, focused }: { tab: Tab; path: VaultPath; focused: boolean }) {
  const app = useApp();
  const { services, actions, ui, workspace } = app;
  const note = app.openNotes.get(app, path);
  const { autosave } = note.saver;
  useFlushOnLeave(autosave);
  // Sync writes what is typed before it commits. A flush of its own per tab: the
  // tabs share the saver, and one closing must not take another's away.
  useEffect(() => services.pendingEdits.add(() => autosave.flush()), [services, autosave]);
  const bridge = useMemo(() => editorBridge(app, note), [app, note]);
  const memory = workspace.memoryOf(tab.id);
  const article = useKeptScroll(memory);
  const preview = tab.preview;
  const wantsEditor = useUi(
    (state) =>
      focused && state.pendingFocus?.path === path && state.pendingFocus.target === 'editor',
  );
  // Kept from the moment the pane opens: the editor may land a moment later, after the
  // request is cleared, and must still take the caret.
  const [focusEditor] = useState(wantsEditor);
  // The tree changes when paths do: enough to notice this note was deleted or moved.
  useVault((vault) => vault.tree);
  // While reading, follow every change (a sync may pull new text); while editing, none.
  useVault((vault) => (preview ? vault.version : 0));
  const file = services.session.file(path);
  const resolves = useCallback(
    (target: string) => services.session.index.resolve(target) !== null,
    [services],
  );

  useEffect(() => {
    if (wantsEditor) ui.setState({ pendingFocus: null });
  }, [wantsEditor, ui]);

  if (file === null) {
    return (
      <div className="app-empty" role="status">
        There is no note at {path}.
      </div>
    );
  }

  return (
    <article ref={article} className="note-pane" aria-label={noteTitle(path)}>
      <header className="note-header">
        <NoteTitle path={path} focused={focused} beforeRename={autosave.flush} />
        <div className="note-tools">
          <FavoriteToggle path={path} />
          <button
            type="button"
            className="quiet-button"
            aria-pressed={preview}
            title="Read or edit (⌘E)"
            onClick={actions.togglePreview}
          >
            <Icon name={preview ? 'pencil' : 'eye'} />
            <span>{preview ? 'Edit' : 'Read'}</span>
          </button>
        </div>
      </header>
      <div className="note-body">
        {preview ? (
          <Suspense fallback={<div className="read-view" />}>
            <ReadView text={file.text} resolves={resolves} onFollowLink={bridge.followLink} />
          </Suspense>
        ) : (
          <Suspense fallback={<pre className="note-editor-placeholder">{file.text}</pre>}>
            <NoteEditor
              initialText={note.mirror.liveText() ?? file.text}
              autoFocus={focusEditor}
              bridge={bridge}
              mirror={note.mirror}
              memory={memory}
            />
          </Suspense>
        )}
      </div>
      <Backlinks path={path} />
    </article>
  );
}
