import { lazy, Suspense, use, useEffect, useMemo, useRef, useState } from 'react';
import {
  createNoteFromLink,
  embedImage,
  noteTitle,
  rankNoteSuggestions,
  rankTagSuggestions,
} from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import { useLook } from '../appearance/look-glyph.tsx';
import type { EditorBridge } from '../editor/bridge.ts';
import type { Tab } from '../panes/layout.ts';
import { openInFor } from '../panes/open-in.ts';
import type { TabMemory } from '../panes/workspace.ts';
import { useApp, type AppContextValue, type LoadMarkdown } from '../services.ts';
import { Icon } from '../shell/icons.tsx';
import { PageBar, type PageHistory } from '../shell/page-bar.tsx';
import { keyFor } from '../shell/shortcuts.ts';
import { useKeyHost } from '../shell/use-shortcuts.ts';
import { useUi } from '../state/ui-store.ts';
import { useVault } from '../state/vault-store.ts';
import type { Autosave } from './autosave.ts';
import { Backlinks } from './backlinks.tsx';
import type { OpenNote } from './open-notes.ts';
import { NoteFolderButton } from './note-folder-button.tsx';
import { createNoteImages, type NoteImages } from './note-images.ts';
import { useKeptScroll } from './kept-scroll.ts';
import { NoteTags } from './note-tags.tsx';
import { NoteTitle } from './note-title.tsx';
import { createPageCaret, heldKeyOf, type PageCaret } from './page-caret.ts';
import { LOADING_TEXT_CLASS, pressToType } from './page-press.ts';
import { LoadFailedBoundary } from './load-failed-boundary.tsx';
import { SourceView } from './source-view.tsx';
import './note.css';

/**
 * The editor (TipTap, and remark to read and write the markdown) is most of
 * the app's weight, so it loads after the first paint: `preloadEditor`
 * starts it at once, and until it lands the note's text shows as it is.
 */
export const preloadEditor = () => import('../editor/note-editor.tsx');
const NoteEditor = lazy(() => preloadEditor().then(({ NoteEditor }) => ({ default: NoteEditor })));

function editorBridge(
  app: AppContextValue,
  {
    note: { saver, mirror },
    path,
    images,
  }: { note: OpenNote; path: VaultPath; images: NoteImages },
): EditorBridge {
  const { services, actions, deps } = app;
  const { autosave, opened } = saver;
  const index = services.session.index;
  const resolve = (target: string) => index.resolve(target);
  return {
    suggestNotes: (query) => rankNoteSuggestions({ query, notes: index.paths(), resolve }),
    suggestTags: (query) => rankTagSuggestions(query, index.tagCounts()),
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
    loadImage: (src) => images.load(src),
    watchImages: (listener) => images.watch(listener),
    calloutSettings: () => services.session.calloutSettings,
    watchCallouts: (listener) =>
      app.vault.subscribe((now, before) => now.callouts !== before.callouts && listener()),
    embedImage: (file, origin) =>
      embedImage(
        { ...deps, probe: services.imageProbe, clock: services.clock },
        {
          notePath: path,
          image: { name: file.name, mimeType: file.type, size: file.size, origin },
          readBytes: async () => new Uint8Array(await file.arrayBuffer()),
        },
      ),
    opened,
    changed: (read) => autosave.schedule(read),
    blurred: () => void autosave.flush(),
    closed: () => {
      autosave.flush().then(mirror.settled, actions.report);
    },
  };
}

/** The pictures the note shows, read as the editor draws them, and let go when the pane goes. */
function useNoteImages(app: AppContextValue, path: VaultPath): NoteImages {
  const { files, session } = app.services;
  const images = useMemo(
    () => createNoteImages({ files, session, notePath: path }),
    [files, session, path],
  );
  useEffect(() => () => images.release(), [images]);
  return images;
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

/** The folder a note sits in, by its own name, as DFAI's breadcrumb reads it; null at the top. */
function folderName(path: VaultPath): string | null {
  const parts = path.split('/');
  return parts.length > 1 ? (parts[parts.length - 2] ?? null) : null;
}

function MindMapButton({ path }: { path: VaultPath }) {
  const { actions } = useApp();
  const host = useKeyHost();
  return (
    <button
      type="button"
      className="btn btn--ghost page-bar__action"
      title={`Open a mind map of this note beside it (${keyFor('map.open', host)})`}
      onClick={(event) => {
        const openIn = openInFor(event);
        actions.openMap({ kind: 'note', path }, openIn === 'active' ? 'side' : openIn);
      }}
    >
      <Icon name="mind-map" size={15} />
      <span className="page-bar__action-label">Map</span>
    </button>
  );
}

function FavoriteToggle({ path }: { path: VaultPath }) {
  const { actions } = useApp();
  const isFavorite = useVault((vault) => vault.favorites.includes(path));
  return (
    <button
      type="button"
      className={`page-bar__button star${isFavorite ? ' star--on' : ''}`}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      onClick={() => actions.toggleFavorite(path).catch(actions.report)}
    >
      <Icon name="star" size={15} filled={isFavorite} />
    </button>
  );
}

/**
 * The note in the editor, or as its plain markdown (⌘E), once the markdown
 * reader has loaded: until then the pane's fallback shows the text as it is.
 */
function NoteView({
  source,
  loadMarkdown,
  ...view
}: {
  source: boolean;
  text: string;
  loadMarkdown: LoadMarkdown;
  autoFocus: boolean;
  bridge: EditorBridge;
  note: OpenNote;
  memory: TabMemory;
  caret: PageCaret;
}) {
  const markdown = use(loadMarkdown());
  return source ? (
    <SourceView {...view} markdown={markdown} />
  ) : (
    <NoteEditor {...view} markdown={markdown} />
  );
}

/**
 * The note's text as it is, while the editor loads. It holds the focus a
 * new note asks for, or a press on the page gave it, and keeps the keys
 * typed on it for the editor to type in when it lands.
 */
function LoadingText({ text, focus, caret }: { text: string; focus: boolean; caret: PageCaret }) {
  const element = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (focus) element.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <pre
      ref={element}
      className={LOADING_TEXT_CLASS}
      tabIndex={-1}
      onKeyDown={(event) => {
        const key = heldKeyOf(event);
        if (key === null) return;
        event.preventDefault();
        caret.hold(key);
      }}
    >
      {text}
    </pre>
  );
}

/**
 * One note in one tab: its title, the editor or the rendered view, and what
 * links here. Keyed by tab and path. `focused`: the tab is the active pane's.
 */
export function NotePane({
  tab,
  path,
  focused,
  history,
}: {
  tab: Tab;
  path: VaultPath;
  focused: boolean;
  history: PageHistory;
}) {
  const app = useApp();
  const { services, actions, ui, workspace } = app;
  const note = app.openNotes.get(app, path);
  const { autosave } = note.saver;
  useFlushOnLeave(autosave);
  // Sync writes what is typed before it commits. A flush of its own per tab: the
  // tabs share the saver, and one closing must not take another's away.
  useEffect(() => services.pendingEdits.add(() => autosave.flush()), [services, autosave]);
  const images = useNoteImages(app, path);
  const bridge = useMemo(
    () => editorBridge(app, { note, path, images }),
    [app, note, path, images],
  );
  const memory = workspace.memoryOf(tab.id, tab.view);
  const article = useKeptScroll(memory);
  const showSource = tab.source;
  const wantsEditor = useUi(
    (state) =>
      focused && state.pendingFocus?.path === path && state.pendingFocus.target === 'editor',
  );
  // Kept from the moment the pane opens: the editor may land a moment later, after the
  // request is cleared, and must still take the caret.
  const [focusEditor] = useState(wantsEditor);
  const [caret] = useState(createPageCaret);
  // The tree changes when paths do: enough to notice this note was deleted or moved.
  useVault((vault) => vault.tree);
  const look = useLook(path);
  const file = services.session.file(path);

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
    <article
      ref={article}
      className="note-pane"
      aria-label={noteTitle(path)}
      onMouseDown={pressToType(caret)}
    >
      <PageBar
        history={history}
        icon={folderName(path) === null ? 'doc' : 'folder'}
        look={look}
        place={folderName(path)}
        name={noteTitle(path)}
      >
        <div className="page-bar__actions">
          <NoteFolderButton path={path} />
          <MindMapButton path={path} />
          <button
            type="button"
            className="btn btn--ghost page-bar__action"
            aria-pressed={showSource}
            title="Show the markdown (⌘E)"
            onClick={actions.toggleSource}
          >
            <Icon name="code" size={15} />
            <span className="page-bar__action-label">Markdown</span>
          </button>
        </div>
        <FavoriteToggle path={path} />
      </PageBar>
      <div className="page page--note">
        <header className="page-head">
          <NoteTitle path={path} focused={focused} beforeRename={autosave.flush} />
        </header>
        {!showSource && <NoteTags path={path} />}
        <div className="page__body">
          <LoadFailedBoundary
            text={file.text}
            onRetry={() => void services.loadMarkdown({ afresh: true }).catch(() => undefined)}
          >
            <Suspense fallback={<LoadingText text={file.text} focus={focusEditor} caret={caret} />}>
              <NoteView
                source={showSource}
                text={file.text}
                loadMarkdown={services.loadMarkdown}
                autoFocus={focusEditor}
                bridge={bridge}
                note={note}
                memory={memory}
                caret={caret}
              />
            </Suspense>
          </LoadFailedBoundary>
        </div>
        <Backlinks path={path} />
      </div>
    </article>
  );
}
