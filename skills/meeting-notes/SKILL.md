---
name: meeting-notes
description: File a meeting into James's notes vault as a meeting note. Use when asked to "file this meeting", "save these meeting notes", or to write up a transcript, pasted notes or a recording summary. Explains the note's exact shape, where it goes, how to find an existing note for the same meeting first, and how to link the people and projects already in the vault.
---

# File a meeting

The vault is the GitHub repository the `notes-vault` skill names. Its root
`CLAUDE.md` is the contract ("A meeting note") and wins wherever this skill
differs. Read it first if you have not this session.

## 1. Pin down the meeting

From what you were given, find: the **day** (`YYYY-MM-DD`), start and end if
stated, a short **title**, who was there, and what it was about. Ask only for
the day if nothing states it; never guess it from today's date.

## 2. Look for the same meeting first

Pull, then read `_index/meetings/<YYYY>-<MM>.md` for that month. A line with
the same date and title (or the same people and subject) is this meeting:
**add to that note** (step 5) instead of making a second one. The path is
`Meetings/<YYYY>/<MM>/<YYYY-MM-DD> <title>.md`.

## 3. Link what already exists

- People: read `_index/folders/People.md` and use the spelling there
  (`[[Mara Quill]]`, not `[[Mara]]`). Only someone with no note yet gets a new
  spelling: their full name as given. Never make up a name; with only an
  address, link its local part (`[[mara.quill]]`).
- Projects and areas: check `_index/folders/Projects.md` and `Areas.md`, and
  `_index/tags.md` for tags. Link earlier meetings by their file name.

## 4. Write the note in exactly this shape

```markdown
One sentence on what was decided or discussed. #meeting

- When: 2026-11-21 10:00–10:30
- With: [[Mara Quill]], [[Tobias Fenn]]
- About: [[Larkspur rollout]]

## Summary

## Decisions

## Next steps

- [[Mara Quill]] sends the revised plan by Friday.

## Notes

## Transcript

**Mara Quill** [00:00:05] Shall we start with the flag?
```

- No frontmatter. The first sentence is the summary's first sentence.
- Leave out any section with nothing in it. The transcript goes last, one
  `**Speaker** [time] words` paragraph per turn, as given: do not tidy it.
- Next steps start with their owner as a link. Decisions are bullets.
- The title in the file name has none of `/ \ : * ? " < > | # ^ [ ]`.

## 5. Adding to an existing note

Add only the sections the note lacks, in the order above (a transcript goes
at the end). Leave every existing line byte for byte, even where your version
reads better: a person may have edited it. If something new belongs in an
existing section, append it there and say so.

## 6. Commit

Pull first, one small commit with the message `Meeting: <YYYY-MM-DD> <title>`,
push. If the push is refused, pull and push again; never force, never touch
`_index/`. Say which path you wrote.
