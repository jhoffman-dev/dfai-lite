import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { folderOf, rankNoteSuggestions } from '../../application/index.ts';
import type { VaultPath } from '../../domain/vault/index.ts';
import type { OpenIn } from '../panes/layout.ts';
import { openInFor } from '../panes/open-in.ts';
import { useApp } from '../services.ts';
import { createCommands } from '../shell/commands.ts';
import { keyFor, type Command } from '../shell/shortcuts.ts';
import { useKeyHost } from '../shell/use-shortcuts.ts';
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
  | { readonly kind: 'shortcuts' };

/** The commands the palette offers by name, as it words them. */
const PALETTE_COMMANDS: readonly { readonly command: Command; readonly title: string }[] = [
  { command: 'note.move', title: 'Move note to…' },
  { command: 'sidebar.toggle', title: 'Show or hide the sidebar' },
  { command: 'note.rename', title: 'Rename note' },
  { command: 'note.new', title: 'New note' },
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
  return parts.map((part, at) => (at % 2 === 1 ? <mark key={at}>{part}</mark> : part));
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
      ...names.map((note) => ({ kind: 'name' as const, path: note.path, title: note.title })),
      ...commandsMatching(typed),
      ...texts.map((hit) => ({ kind: 'text' as const, ...hit })),
      ...(exact ? [] : [{ kind: 'create' as const, name: typed }]),
    ];
  }, [query, services]);
}

/** ⌘K: one field that switches to a note by name, searches the text, or makes the note. */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const { actions, ui } = app;
  const host = useKeyHost();
  const run = useMemo(() => createCommands(app), [app]);
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
      className="dialog-scrim"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search notes">
        <input
          className="palette-input"
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
        <ul id="palette-results" className="palette-results" role="listbox" aria-label="Results">
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
              className={`palette-row is-${row.kind}`}
              onPointerMove={() => setSelected(at)}
              onClick={(event) => choose(row, openInFor(event))}
              onAuxClick={(event) => event.button === 1 && choose(row, 'new-tab')}
            >
              {row.kind === 'shortcuts' ? (
                <span className="palette-title">Keyboard shortcuts</span>
              ) : row.kind === 'command' ? (
                <>
                  <span className="palette-title">{row.title}</span>
                  <kbd className="palette-folder">{keyFor(row.command, host)}</kbd>
                </>
              ) : row.kind === 'create' ? (
                <span className="palette-title">Create note “{row.name}”</span>
              ) : (
                <>
                  <span className="palette-title">{row.title}</span>
                  <span className="palette-folder">{folderOf(row.path)}</span>
                  {row.kind === 'text' ? (
                    <span className="palette-snippet">{highlighted(row.snippet, query)}</span>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
