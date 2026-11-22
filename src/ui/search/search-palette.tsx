import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { folderOf, rankNoteSuggestions } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import type { OpenIn } from '../panes/layout.ts';
import { openInFor } from '../panes/open-in.ts';
import { useApp } from '../services.ts';
import { createCommands } from '../shell/commands.ts';
import { keyFor, type Command } from '../shell/shortcuts.ts';
import { useKeyHost } from '../shell/use-shortcuts.ts';
import { LookGlyph } from '../appearance/look-glyph.tsx';
import { Icon, type IconName } from '../shell/icons.tsx';
import { useVault } from '../state/vault-store.ts';
import { useTheme } from '../theme/use-theme.ts';
import './search.css';

const NAME_ROWS = 6;
const TEXT_ROWS = 20;

type PaletteRow =
  | { readonly kind: 'name'; readonly path: VaultPath; readonly title: string }
  | {
      readonly kind: 'text';
      readonly path: VaultPath;
      readonly title: string;
      readonly snippet: string;
    }
  | { readonly kind: 'create'; readonly name: string }
  | { readonly kind: 'command'; readonly command: Command; readonly title: string }
  | { readonly kind: 'shortcuts' }
  | { readonly kind: 'theme' };

/** The commands the palette offers by name, as it words them. */
const PALETTE_COMMANDS: readonly { readonly command: Command; readonly title: string }[] = [
  { command: 'note.move', title: 'Move note to…' },
  { command: 'sidebar.toggle', title: 'Show or hide the sidebar' },
  { command: 'note.rename', title: 'Rename note' },
  { command: 'note.new', title: 'New note' },
  { command: 'history.back', title: 'Go back' },
  { command: 'history.forward', title: 'Go forward' },
];

/** The commands every typed word is in, case aside. */
function commandsMatching(typed: string): PaletteRow[] {
  const words = typed.toLowerCase().split(/\s+/);
  return PALETTE_COMMANDS.filter(({ title }) =>
    words.every((word) => title.toLowerCase().includes(word)),
  ).map((entry) => ({ kind: 'command' as const, ...entry }));
}

/** Typed alone, it lists the keyboard shortcuts instead of searching. */
const HELP_QUERY = '?';

/** Words that offer the light/dark switch at the top of the list, typed whole or begun (3+ letters). */
const THEME_WORDS = ['theme', 'dark', 'light', 'appearance', 'dark mode', 'light mode'];

function asksForTheme(typed: string): boolean {
  const lower = typed.toLowerCase();
  return lower.length >= 3 && THEME_WORDS.some((word) => word.startsWith(lower));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The snippet with each word of the query marked, as React text (never HTML). */
function highlighted(snippet: string, query: string): ReactNode[] {
  const words = query
    .split(/\s+/)
    .filter((word) => word !== '')
    .map(escapeRegExp);
  if (words.length === 0) return [snippet];
  const parts = snippet.split(new RegExp(`(${words.join('|')})`, 'gi'));
  return parts.map((part, at) =>
    at % 2 === 1 ? (
      <mark key={at} className="palette__mark">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function usePaletteRows(query: string): PaletteRow[] {
  const { services } = useApp();
  return useMemo(() => {
    const typed = query.trim();
    if (typed === '') return [];
    if (typed === HELP_QUERY) return [{ kind: 'shortcuts' }];
    const index = services.session.index;
    const names = rankNoteSuggestions({
      query: typed,
      notes: index.paths(),
      resolve: (target) => index.resolve(target),
      limit: NAME_ROWS,
    });
    const named = new Set(names.map((note) => note.path));
    const texts = services.search
      .search(typed, { limit: TEXT_ROWS })
      .filter((hit) => !named.has(hit.path));
    const exact = names.some((note) => note.match === 'exact');
    return [
      ...(asksForTheme(typed) ? [{ kind: 'theme' as const }] : []),
      ...names.map((note) => ({ kind: 'name' as const, path: note.path, title: note.title })),
      ...commandsMatching(typed),
      ...texts.map((hit) => ({ kind: 'text' as const, ...hit })),
      ...(exact ? [] : [{ kind: 'create' as const, name: typed }]),
    ];
  }, [query, services]);
}

const KIND_GLYPHS: Readonly<Record<Exclude<PaletteRow['kind'], 'command'>, IconName>> = {
  name: 'doc',
  text: 'doc',
  create: 'plus',
  shortcuts: 'keyboard',
  theme: 'moon',
};

const COMMAND_GLYPHS: Partial<Readonly<Record<Command, IconName>>> = {
  'note.move': 'folder',
  'sidebar.toggle': 'sidebar',
  'note.new': 'plus',
  'history.back': 'arrow-left',
  'history.forward': 'arrow-right',
};

function glyphOf(row: PaletteRow): IconName {
  if (row.kind === 'command') return COMMAND_GLYPHS[row.command] ?? 'doc';
  return KIND_GLYPHS[row.kind];
}

/** A row's words: its title, and where the note lives with the words that matched. */
function RowText({ row, query, next }: { row: PaletteRow; query: string; next: string }) {
  if (row.kind === 'shortcuts') return <span className="palette__title">Keyboard shortcuts</span>;
  if (row.kind === 'theme') return <span className="palette__title">Switch to {next} theme</span>;
  if (row.kind === 'command') return <span className="palette__title">{row.title}</span>;
  if (row.kind === 'create') {
    return <span className="palette__title">Create note “{row.name}”</span>;
  }
  const place = folderOf(row.path);
  return (
    <>
      <span className="palette__title">{row.title}</span>
      {place === '' && row.kind === 'name' ? null : (
        <span className="palette__detail">
          {place === '' ? null : <span className="palette__place">{place}</span>}
          {row.kind === 'text' ? (
            <span className="palette__snippet">{highlighted(row.snippet, query)}</span>
          ) : null}
        </span>
      )}
    </>
  );
}

/** ⌘K: one field that switches to a note by name, searches the text, or makes the note. */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const { actions, ui, theme } = app;
  const host = useKeyHost();
  const looks = useVault((vault) => vault.appearances);
  const run = useMemo(() => createCommands(app), [app]);
  const shown = useTheme(theme).theme;
  const next = shown === 'dark' ? 'light' : 'dark';
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const rows = usePaletteRows(query);
  const current = Math.min(selected, rows.length - 1);

  // Enter opens in the active tab, ⌘/Ctrl-Enter in a new tab, ⌥-Enter in the other pane.
  const choose = (row: PaletteRow | undefined, openIn: OpenIn) => {
    if (row === undefined) return;
    onClose();
    if (row.kind === 'shortcuts') ui.setState({ shortcutsOpen: true });
    else if (row.kind === 'command') run(row.command);
    else if (row.kind === 'theme') theme.toggle();
    else if (row.kind === 'create') actions.followLink(row.name, openIn).catch(actions.report);
    else actions.openNote(row.path, openIn);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose();
    else if (event.key === 'Enter') {
      const { metaKey, ctrlKey, altKey } = event;
      choose(rows[current], openInFor({ button: 0, metaKey, ctrlKey, altKey }));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelected((current + step + rows.length) % Math.max(rows.length, 1));
    } else return;
    event.preventDefault();
  };

  return (
    <div
      className="palette__backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search notes">
        <div className="palette__field">
          <span className="palette__field-icon">
            <Icon name="search" size={17} />
          </span>
          <input
            className="palette__input"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="palette-results"
            aria-activedescendant={rows.length > 0 ? `palette-row-${current}` : undefined}
            placeholder="Find or create a note… (? for shortcuts)"
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="key">esc</kbd>
        </div>
        <ul id="palette-results" className="palette__hits" role="listbox" aria-label="Results">
          {rows.map((row, at) => (
            <li
              key={
                'path' in row
                  ? `${row.kind}:${row.path}`
                  : row.kind === 'command'
                    ? `command:${row.command}`
                    : row.kind
              }
              id={`palette-row-${at}`}
              role="option"
              aria-selected={at === current}
              className={`palette__hit${at === current ? ' palette__hit--on' : ''}`}
              onPointerMove={() => setSelected(at)}
              onClick={(event) => choose(row, openInFor(event))}
              onAuxClick={(event) => event.button === 1 && choose(row, 'new-tab')}
            >
              <span className="palette__kind">
                {'path' in row ? (
                  <LookGlyph look={looks.get(row.path) ?? null} fallback={glyphOf(row)} />
                ) : (
                  <Icon name={glyphOf(row)} size={15} />
                )}
              </span>
              <span className="palette__text">
                <RowText row={row} query={query} next={next} />
              </span>
              {row.kind === 'command' ? (
                <kbd className="key">{keyFor(row.command, host)}</kbd>
              ) : null}
              {at === current ? <kbd className="key palette__enter">↵</kbd> : null}
            </li>
          ))}
        </ul>
        <div className="key-hints">
          <span className="key-hints__hint">↑ ↓ to move</span>
          <span className="key-hints__hint">↵ to open</span>
          <span className="key-hints__hint">esc to close</span>
        </div>
      </div>
    </div>
  );
}
