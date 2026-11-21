# DFAI Lite

A fast, local markdown notes app for the Mac. Your vault is a folder of plain
`.md` files on your Mac (title = file name, no frontmatter), linked with
`[[wikilinks]]` and tagged inline with `#tags`. The folder is a git clone, and
the app syncs it with your Mac's own `git`: there is no server, no web
version, and no token in the app. Claude Code, your editor and git can change
the same files; the app follows.

The vault's rules are in [`vault-template/CLAUDE.md`](vault-template/CLAUDE.md);
how to work on the app is in [`CLAUDE.md`](CLAUDE.md).

## Install, run, build

Needs Node 22+, pnpm, and Rust (`rustup`). On James's Macs:

```sh
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
pnpm install
pnpm tauri dev                # the app, with hot reload
pnpm tauri build              # src-tauri/target/release/bundle/macos/DFAI Lite.app
pnpm tauri build --debug      # a debug .app, quicker to build
```

Copy `DFAI Lite.app` to `/Applications`. Other commands:

```sh
pnpm dev          # the UI alone in a browser, on a sample vault in memory (no sync)
pnpm check        # typecheck + lint + format:check + unit and real-git sync tests + build
pnpm e2e          # build, then the Playwright smoke (Chromium, sample vault)
pnpm rust:check   # cargo fmt --check, clippy -D warnings, cargo test
pnpm index <path-to-vault>   # write _index/ for a vault folder by hand
```

## Pick a vault

On first start the app asks for your notes folder. To use notes that live in
GitHub, clone the repository first, then choose its folder:

```sh
git clone https://github.com/<you>/notes.git ~/Notes
```

Any folder works; one that is not a git clone simply does not sync. Change the
folder in Settings. The app keeps this Mac's settings (the folder, the
capture key, how the window looks) in
`~/Library/Application Support/com.dailyflowai.dfai-lite/settings.json`.

**Quick capture:** ⌥⌘N, from any app while DFAI Lite is open, brings the
window forward on a new note in `Inbox/`. Change the key in Settings. In the
app, ⌘N does the same.

## How sync works

The way DFAI does it, with the Mac's own `git` and the login it already has
(HTTPS credential helper or SSH key):

1. About 30 seconds after the vault last changed (at least every 5 minutes
   while changes keep coming), and every minute to look for other Macs'
   changes, the app writes `_index/`, then commits everything changed
   (`Notes: <title>` or `Notes: 3 changed`).
2. It fetches and **merges** the upstream branch: never a rebase, never a
   force-push. A refused push fetches, merges and pushes again.
3. A note both Macs changed keeps this Mac's version at its name, and the
   other Mac's beside it as `<name> (conflict from <Mac>).md`. A delete never
   beats an edit. A conflict in `_index/` is settled by writing it afresh.
4. Offline, or git's login refused: the commit stays on this Mac, the chip in
   the sidebar says so, and the next sync pushes it.

A vault folder that is not a git repository, or whose branch has no upstream,
works the same and shows "Sync off".

## Layout

| Where              | What                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `src/domain/`      | The rules, pure: `links/`, `tags/`, `vault/`, `index/`, `favorites/`, `sync/`, `ai-index/`             |
| `src/application/` | `ports/` (vault files, git, settings, search), `session/`, `use-cases/`, `sync/`, `testing/` fakes     |
| `src/adapters/`    | `tauri/` (the host), `memory/` (the sample vault), `settings/`, `search/`, `clock/`                    |
| `src/ui/`          | React components                                                                                       |
| `src/app/`         | The composition root: the Mac app on its folder, or the sample vault in a browser                      |
| `src-tauri/`       | The Rust host: read the vault in one call, guarded writes, the watcher, fixed-shape git. No rules here |
| `tools/`           | Node scripts reusing `src/domain`, and the real-git sync tests (`tools/testing/` adapters)             |
| `e2e/`             | The Playwright smoke                                                                                   |

Each module is imported through its `index.ts`; ESLint holds the layer
direction (domain → nothing, application → domain, adapters → both, UI →
application and domain types).
