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

Sync never guesses on your behalf:

- A merge, rebase or cherry-pick you started in Terminal is yours: sync shows
  "Sync paused" until you finish it, and touches nothing.
- If more than 20 notes, and more than a tenth of the vault, are gone from the
  folder, sync asks in Settings before it deletes them on every Mac. iCloud
  stand-ins (`.Note.md.icloud`, from Optimize Mac Storage) pause sync instead.
- The app keeps a block of its own at the end of the vault's `.gitignore`
  (temporary files, `.DS_Store`, `.claude/`, `.env`), plus files over
  GitHub's 100 MB limit and folders that are repositories of their own; it
  never changes your lines.
- While sync commits or merges, saves wait; a note the merge changed gets your
  typing as a conflict copy.

## Granola

The Mac app imports the meetings you record in [Granola](https://granola.ai)
the way DFAI does: through Granola's public API, with a personal API key.
Each meeting becomes a note at `Meetings/<YYYY>/<MM>/<YYYY-MM-DD> <title>.md`
in the vault's meeting shape: its first sentence, `- When:`, `- With:` (each
person as a `[[link]]`; no People note is made), `- Source:` (the meeting in
Granola), then Summary (Granola's notes), Notes (your own notes) and the
Transcript, with speakers and times. A picture in Granola's text is written as
a plain link to it (`[image](https://…)`), so opening a note never loads
anything from the web; wiki links and ordinary links stay as they are.

- **Connect**: in Granola, Settings → Connectors → API keys (a Business or
  Enterprise plan), make a key, and paste it in DFAI Lite's Settings → Granola.
  The app imports once the vault has synced, then every 15 minutes while it is
  open (turn "Import automatically" off to import only with Import now).
  Import now lists every meeting, to find one that is missing.
- **Where the key is kept**: in this Mac's login Keychain (service
  `com.dailyflowai.dfai-lite`, one item per vault folder). Only the app's Rust
  host reads it, to call `https://public-api.granola.ai`; the window can ask
  whether a key is kept, never for the key itself. It is never written to the
  vault, the settings file or a log. Each Mac needs its own key pasted.
- **Disconnect**: Settings → Granola → Disconnect removes the key from the
  Keychain. Meetings already imported stay. The key is kept for the vault
  folder where it is: move the vault and paste the key again.
- **The first import** lists every meeting in Granola, as DFAI's first pull
  does, oldest first; an import cut short carries on where it stopped.
- **No duplicates**: `.dfai-lite/imports.json` (synced, like the favorites)
  records which Granola meeting became which note, and follows a note you
  rename or move. A meeting Granola changes later gets only the sections its
  note lacks (a transcript that came after the summary); nothing you wrote is
  rewritten. A meeting whose note you deleted is not imported again; Settings
  offers to bring those back. If the ledger is lost, the notes' `- Source:`
  lines stand in for it; if it cannot be read, imports stop and Settings
  offers to rebuild it from those lines (the deleted meetings come back then)
  or start an empty one.
- **Queued for Claude**: each new meeting note gets a line in
  `Meetings/Processing queue.md`, once (`node tools/meeting-note.ts` queues
  its new notes too; the n8n flow does not). Claude works the list with the
  `meeting-processing` skill (`skills/`, and a copy in each new vault), which
  writes a `[!summary]` callout by Claude before the note's first section and
  then takes the line out. A queue line that could not be written is written
  on the next import. When both Macs change the queue, sync keeps both sides'
  lines in the one file rather than making a conflict copy.
- **Granola and the n8n/Gemini flow together**: both may be on. A note at the
  same path is the same meeting, as the vault contract says, so a Granola
  import adds the sections a Gemini note lacks rather than making a second
  note. Two different Granola meetings with the same title on the same day
  are kept apart as DFAI does: the second is
  `<YYYY-MM-DD> <title> (granola <8 hex>).md`.

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
