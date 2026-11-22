# DFAI Lite — working notes

A fast, local markdown notes app for the Mac. It is DFAI with everything but
the notes taken out: no tables, tasks, dashboards, custom types, assistant or
frontmatter. James's work now runs through Claude, so the vault is built to be
read and written by Claude as much as by the app.

The vault is a folder of markdown files on this Mac, which is also a git
clone. The app reads and writes the files and syncs by running the Mac's own
`git`, the way DFAI does. There is no web version and no server.

## The process is light, on purpose

James asked for this on 2026-11-21: nothing in this app is critical, and a bug
that is fixed in minutes costs less than a day of gates. So this file sets
explicit exceptions to his user-level rules (`~/.claude/CLAUDE.md`), and wins
where they differ:

| Rule elsewhere                            | Here                                                                                             | Why                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 70% coverage floor in CI, 90% on the core | No floor. Domain rules and sync are tested because those tests are cheap and catch real bugs.    | A floor is a gate; the gate was the problem. |
| Bug fix commits its failing test first    | A fix in `domain` or sync adds a test in the same commit. A UI fix needs none.                   | Speed of fix over proof of process.          |
| Unit, integration and e2e for every layer | Unit for domain, real-git tests for sync, one e2e smoke of the core loop.                        | One smoke catches "the app is broken".       |
| Review and attack passes before merge     | None by default. One `code-reviewer` pass when a change touches how notes are written or synced. | That is the one place a bug can lose a note. |

What still holds, unchanged: dependencies point inward, the Clean Code rules,
deterministic tests, report failures with their output, never claim something
works because it compiles. **This repository is public**: no real names of
James's employer, clients, coworkers or family in code, tests, fixtures or
commits (use Larkspur Payroll, Mara Quill, Tobias Fenn, `example.com`). His
first name is James, never guessed.

## How a change ships

1. One ticket (a GitHub issue here), one branch, one agent: `coder` for a
   feature, `bug-fixer` for a bug. Small things the coordinator does itself.
2. The author runs `pnpm check` (it should stay under a minute) and, if a flow
   changed, `pnpm e2e`. If Rust changed, `pnpm rust:check`.
3. Open the PR ready, not draft. CI is one workflow, `check`, on Linux only:
   it must finish in about two minutes. **No macOS runner, ever**: the Mac app
   is built on James's Mac (`pnpm tauri build`), not in CI.
4. Green: merge it (`gh pr merge --squash`). No ready note, no sweep, no trial.
5. Broken on `main`? Fix forward or `git revert`, same flow.

Held for James: anything that could rewrite or delete a vault's history (a
force-push, a bulk delete or move of notes), and changes to this file's rules.

The agents in `.claude/agents/` came from DFAI and defer to this file, so
where an agent's text says "failing test first, in its own commit", "70% /
90%" or "hand the full gate to `tester`", the table above replaces it.
`tester`, `adversarial-tester`, `pr-review-fixer` and `pr-merger` are there
but not part of the flow; use one when James asks. Each agent runs on the
model its own file names: never pass a model override.

## Commands

```sh
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"   # Node and Rust on James's Macs
pnpm tauri dev    # run the app
pnpm tauri build  # build the Mac app (local only)
pnpm dev          # the UI alone in a browser, on a sample vault in memory
pnpm check        # typecheck + lint + format:check + unit tests + build
pnpm e2e          # build, then the Playwright smoke (Chromium, sample vault)
pnpm rust:check   # cargo fmt --check, clippy, test
pnpm index        # write _index/ for a vault folder: pnpm index <path-to-vault>
```

## Shape of the code

One package. The layers are folders under `src/`, and ESLint holds the import
direction.

| Where             | What belongs there                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain`      | The rules. Pure: no I/O, no clock, no randomness, no React. Links, tags, the vault tree, the AI index, conflict copies, the sync schedule.               |
| `src/application` | Use-cases and the ports they need (vault files, git, clock, settings, search).                                                                           |
| `src/adapters`    | Tauri (files, watcher, git, hotkey), an in-memory vault for the browser and tests, the search engine. Thin: they translate.                              |
| `src/ui`          | React components. No rules: a component that decides what happens next is in the wrong layer.                                                            |
| `src/app`         | The composition root: builds the adapters, hands them to the use-cases, mounts the UI.                                                                   |
| `src-tauri`       | The Rust host. **As little as possible**: official Tauri plugins first; a custom command only where a plugin is too slow or missing. It decides nothing. |
| `tools/`          | Node scripts that reuse `src/domain`: the index writer, the DFAI vault migration.                                                                        |
| `vault-template/` | What a new vault starts with: its `CLAUDE.md`, folders, and the workflow that keeps `_index/` fresh.                                                     |
| `skills/`         | Agent Skills for James's Claude account, so Claude finds and uses the vault from any product.                                                            |

Stack: Tauri 2, React 19, Vite, TypeScript (strict, erasable syntax only),
CodeMirror 6, `markdown-it` + DOMPurify for the read view, MiniSearch,
d3-force, zustand, Vitest, Playwright. Plain CSS, one file per feature.
Headless libraries only, no component kit.

## How it works

- **The files are the data.** A note is a `.md` file in the vault folder. The
  app keeps an index in memory, rebuilt from the files; nothing lives only in
  an index, and there is no database.
- **Other programs edit the vault too** (Claude Code, git, an editor). A
  watcher tells the app, and the open note follows. If a note changed
  underneath an unsaved edit, the edit is saved beside it as a conflict copy.
- **Sync is the Mac's own git**, as in DFAI: commit, fetch, merge (never
  rebase), settle conflicts, push. A push follows about 30 s after the last
  change; a pull check runs every minute. The app holds no GitHub token: it
  uses the login `git` already has.
- **A conflict never loses text.** This Mac's version stays in place; the
  other side is saved beside it as `<name> (conflict from <Mac>).md`.
- **The `_index/` folder is written before each commit**, so every push
  carries a fresh index for Claude.

## The vault contract

`vault-template/CLAUDE.md` is the contract, written for Claude and people
alike; the app obeys the same rules. The short form:

- A note is a `.md` file. Its title is its file name. **No frontmatter.**
- Tags are inline `#tag` (nested `#area/topic`), anywhere outside code.
- Links are `[[Note name]]`, `[[Note name|shown text]]`, `[[Note#Heading]]`.
  Resolution follows Obsidian: a path if it has a slash, else that name
  anywhere, shallowest first. Following a link to a note that does not exist
  creates the note.
- Favorites are `.dfai-lite/favorites.json`: a list of paths, synced.
- `_index/` is generated. Never edit it by hand, never treat it as truth.
- Meetings land in `Meetings/<YYYY>/<MM>/<YYYY-MM-DD> <title>.md`.

A change to the contract changes `vault-template/CLAUDE.md`, the skill in
`skills/`, and the code together.

## Things that will bite

- **The webview has no Node.** `Buffer`, `process`, `node:fs` pass Vitest and
  fail in the app. `tools/` may use Node; `src/` may not (ESLint holds it).
- **Rendered markdown is untrusted.** The read view goes through DOMPurify,
  always.
- **Never force-push a vault, never rebase it, never `git clean` or
  `reset --hard` it.** A refused push means fetch, merge, push again.
- **Git arguments are fixed shapes.** A note's name never becomes a git
  option: paths go after `--`.
- **Index output must be deterministic**: the same notes give the same bytes.
  No timestamps, no machine names, sorted keys and paths.
- **Speed is the feature.** Opening the app, opening a note, typing, and a new
  note must feel instant on a 2,000-note vault. Read the vault in one host
  call, keep work off the keystroke path, virtualize long lists.
- **Rust lives in `~/.cargo`**, and a Tauri `target/` folder is several GB:
  one checkout builds at a time on this Mac.
