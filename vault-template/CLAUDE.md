# This vault

Markdown notes in folders, synced through this GitHub repository. People edit
them in DFAI Lite; Claude reads and writes them here. This file is the entry
point: read it first, then use `_index/` to find notes without opening them.

## Find things cheaply

Do not list or read the whole vault. Go in this order, and stop as soon as
you have the notes you need:

1. **`README.md`** at the root: the map. What each folder holds and how many
   notes it has, the busiest folders, the most used tags, the latest dated
   notes. Its map is generated between markers; the text around it is
   James's own description of the vault.
2. **The index**, for one line per note (path, tags, links out, `←`
   backlinks, first sentence):

   | To find…                     | Read                                            |
   | ---------------------------- | ----------------------------------------------- |
   | What folders and areas exist | `_index/README.md` (counts per folder)          |
   | Notes in a folder            | `_index/folders/<folder>.md`                    |
   | Notes with a tag             | `_index/tags.md`                                |
   | A meeting, by date or person | `_index/meetings/<YYYY>-<MM>.md`                |
   | What links to a note         | the note's line in its folder index (`←` lists) |

3. **Search**, when working in this folder: `node .dfai-lite/search.mjs`
   reads the notes themselves, so it is never behind. It prints the best 10
   notes, each as its path, tags and change date, then up to three matching
   lines with their line numbers. Words must all match; quote a phrase
   (`'"exact phrase"'`); notes named for the words rank first, then headings,
   then body text, newer first on ties.

   ```sh
   node .dfai-lite/search.mjs "rollout plan" --folder Projects
   node .dfai-lite/search.mjs --tag meeting --since 14d
   node .dfai-lite/search.mjs --links-to "Mara Quill" --limit 25
   ```

   `--title` matches names only; `--since` takes a date or `Nd` (the file's
   change time on this Mac); `--transcripts` adds `Transcripts/` for
   verbatim quotes, which are skipped otherwise; `--help` lists the rest.
   Prefer it to `grep` or reading folders: its output is already trimmed.

4. **Open a note** only once its index line or search lines say it is the
   one, and read the part the line numbers point to.

`_index/` and the README map are generated on every push, so they can be a
minute behind; search is not. If a note and the index disagree, the note is
right. Through GitHub, without a shell, read `README.md` and `_index/`, then
use the repository's code search for an exact phrase.

## Layout

| Folder                   | Holds                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `Inbox/`                 | Quick notes, unfiled. New notes with no obvious home go here.                                        |
| `Meetings/<YYYY>/<MM>/`  | One note per meeting (shape below).                                                                  |
| `People/`                | One note per person, named as they are linked: `Mara Quill.md`.                                      |
| `Projects/`, `Areas/`    | Work with an end, and ongoing responsibilities.                                                      |
| `Resources/`             | Reference material and permanent notes.                                                              |
| `Archive/`               | Finished or dormant. Move here; do not delete.                                                       |
| `attachments/`           | Pictures pasted or dropped into notes.                                                               |
| `skills/<name>/SKILL.md` | Instructions for Claude on jobs done often in this vault.                                            |
| `_index/`                | Generated. Never edit.                                                                               |
| `.dfai-lite/`            | The app's own state (favorites, icons and colors, callout types, imported meetings). Leave it alone. |
| `<folder>/.gitkeep`      | Empty; keeps a folder with no notes yet in git. Leave it.                                            |

## How a note is written

- A note is one `.md` file. **Its title is its file name.** No frontmatter:
  never add a `---` block at the top.
- Start with one plain sentence saying what the note is. The index shows it.
- Tags are inline: `#project`, `#area/health`. Lower case, `/` to nest.
  Reuse a tag from `_index/tags.md` before making a new one.
- Link with `[[Note name]]`, or `[[Note name|shown text]]`. Link people,
  projects and earlier meetings whenever they are mentioned: links are how
  notes are found later. A link to a note that does not exist yet is fine.
- A callout is a quote whose first line is `> [!type] Title`: `note`, `tip`,
  `warning` and the rest of Obsidian's, or a type of the vault's own; any type is fine.
- File names: plain words, no `/ \ : * ? " < > | #  ^ [ ]`.
- A picture is a file in `attachments/`, shown with a standard image whose
  path is relative to the note and percent-encoded:
  `![Chart](../attachments/Q3%20chart.png)`. A width in pixels goes after
  the alt text, as Obsidian writes it: `![Chart|400](…)`. When a note or
  folder moves, the app re-points markdown images (and the `[label]: path`
  definitions images use) that would otherwise break; an HTML `<img>` is
  left as written.

## A meeting note

Path: `Meetings/<YYYY>/<MM>/<YYYY-MM-DD> <title>.md`. If that file exists, it
is the same meeting: add to it rather than making a second one.

```markdown
One sentence on what was decided or discussed. #meeting

- When: 2026-11-21 10:00–10:30
- With: [[Mara Quill]], [[Tobias Fenn]]
- About: [[Larkspur rollout]]
- Source: https://docs.example.com/document/d/weekly-sync

## Summary

## Decisions

## Next steps

- [[Mara Quill]] sends the revised plan by Friday.

## Notes

## Transcript
```

Leave out a line or a section that has nothing in it. `Source` is where the
notes came from, when there is a link. `Notes` holds the detail behind the
summary. The transcript, when there is one, goes last so a reader can stop
before it.

## Meetings waiting for a summary

`Meetings/Processing queue.md` lists the meetings DFAI Lite imported that
have no summary yet, one `- [[link]]` line each. When a session starts in
this vault, or James says "process meetings", read it; if it lists any,
work it with `skills/meeting-processing/SKILL.md`: a summary block in each
note, then its line removed. Never remove a line any other way. In this
folder on a Mac, DFAI Lite syncs: save the files and run no git. Through
GitHub, a conflict in the queue keeps every `- [[` line from both sides,
never a conflict copy (the skill says how).

## Rules for writing here

1. **Pull before you write, and commit small.** One commit per piece of work,
   with a message that says what changed: `Meeting: 2026-11-21 Weekly sync`.
2. **Never force-push, never rewrite history, never delete in bulk.** To
   remove a note, move it to `Archive/`.
3. **Add, do not overwrite.** When changing a note a person wrote, append or
   edit the part asked about; leave the rest byte for byte.
4. **Renaming or moving a note** means updating every `[[link]]` to it in the
   same commit. The folder index shows who links to it.
5. **Do not touch `_index/` or `.dfai-lite/`.**
6. If a push is refused because the branch moved, pull and try again. Never
   resolve it by overwriting.
7. A file ending `(conflict from <Mac>).md` is the other Mac's version of a
   note both Macs changed; the app kept this Mac's at the note's own name. One
   ending `(conflict <date>).md` is text typed while the note changed on disk.
   Leave either for the owner unless asked to merge it.
