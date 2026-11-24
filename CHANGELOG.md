# Changelog

What changed in DFAI Lite, newest first. Each version is tagged `v<version>` on GitHub when it reaches `main`.

## 0.3.0 — 2026-11-24

- New meetings wait for Claude in `Meetings/Processing queue.md`: each meeting imported from Granola (or filed with the meeting-note tool) gets one line there, once.
- The `meeting-processing` skill tells Claude to work that list: it adds a "Summary by Claude" callout to each meeting note, then takes the meeting off the list. New vaults come with the skill and the instructions.
- Syncing a queue both Macs changed keeps every waiting meeting, in the one note, with no conflict copy.

## 0.2.0 — 2026-11-22

- Notes are plain markdown files in a folder on your Mac, edited as rendered text: headings, lists, tables, code, links and `#tags`.
- Folders and favorites in the sidebar; drag notes and folders to move them.
- Search, a graph of the links between notes, and a key that starts a new note from anywhere.
- Tabs, split panes, and Back and Forward through what you opened.
- Pictures: paste or drop them into a note, resize them, open them larger.
- Callouts, with built-in types and your own, in your own colors and icons.
- An icon and a color for any folder or note in the sidebar.
- The block handle and menu: drag a block, duplicate it, turn it into another kind.
- Sync through the Mac's own git; a conflict saves the other side beside your note, never loses it.
- Meetings from Granola imported as notes, once each.
- Settings → About shows this version and the build it came from.

## 0.1.0

- The first build.
