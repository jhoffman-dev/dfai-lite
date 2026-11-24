---
name: meeting-processing
description: Work the vault's meetings queue, `Meetings/Processing queue.md`, writing Claude's summary block into each waiting meeting note and taking its line off the list. Use when a session starts in James's notes vault and the queue lists meetings, when he says "process meetings" or "summarize my meetings", or after a meeting import. Gives the summary block's exact shape, where it goes, and what never to change.
---

# Process the meetings queue

DFAI Lite adds a line to `Meetings/Processing queue.md` each time it imports
a new meeting. Your job: give each listed meeting note a summary block, then
take its line off the list. The vault's root `CLAUDE.md` is the contract and
wins wherever this skill differs; read it first if you have not this session.

## 1. Read the queue

Start from the latest vault (section 2a says how). Open
`Meetings/Processing queue.md`. Every line starting
`- [[` is one waiting meeting:

```markdown
- [[Meetings/2026/11/2026-11-17 Larkspur Payroll renewal]] added 2026-11-17
```

The link is the note's path without `.md`. Leave every other line (the
header, anything James typed) as it is. No queue, or no lines: say so, stop.

## 2. For each line, top to bottom

1. **Open the note** at the link's path plus `.md`. Not there: it was
   renamed or moved. Look its title up in `_index/meetings/` or search for
   the file name; if you find it, use it, else leave the line (step 4).
2. **Already summarized?** If the note holds `<!-- dfai-lite:summary v1 -->`,
   it is done: remove the line and go on. Never write a second block, and
   never rewrite one unless James asks.
3. **Nothing to summarize yet?** With no transcript and no notes (Granola
   sends a transcript later), leave the line (step 4).
4. **Leaving a line**: add ` — not processed: <short reason>` to the end of
   it, replacing an earlier reason, and keep it in the queue. For example:
   `note not found`, `no transcript or notes yet`, `could not save`.
5. **Write the block** (section 3) into the note and save it.
6. **Then remove the line**, only after the note is saved. Delete that one
   line, nothing else.

## 2a. Saving and syncing: who runs git

Where you are decides it. There is no third way.

- **In the vault's folder on a Mac** (Claude Code started in it): DFAI Lite
  syncs this folder. **Do not run git at all**: no pull, commit, push, merge
  or stash. Read and save the files only; the app sees each save, commits it
  and syncs it within about a minute, and it merges the queue itself when
  another Mac changed it too. If the app is not open, the saves wait in the
  folder until it is.
- **Through the GitHub repository** (no local folder of the vault; the
  `notes-vault` skill): read the newest `main`, and save the notes and the
  queue in one commit, named for what it did:
  `Meetings: summaries for 3 meetings`. Never force. If the commit is refused
  because `main` moved, read the files again and redo your edits on them.
  If a merge leaves `Meetings/Processing queue.md` in conflict, settle it by
  hand this way: keep every `- [[` line from both sides (one line per note;
  where only one side's line has a ` — not processed:` reason, keep that
  one), keep every other line either side has, delete the `<<<<<<<`,
  `=======` and `>>>>>>>` lines, and never make a conflict copy. The only
  lines you may leave out are ones you removed yourself because that
  meeting is done. A line coming back is harmless; a lost one is not.

## 3. The summary block

Put it before the note's first `##` heading (at the end if it has none), with
one blank line before and after. Shape, exactly:

```markdown
<!-- dfai-lite:summary v1 -->

> [!summary] Summary by Claude (<your model id>, <today YYYY-MM-DD>)
> One paragraph: what the meeting was for and where it landed.
>
> **Key points**
>
> - …
>
> **Decisions**
>
> - …
>
> **Action items**
>
> - What is to be done: Owner
>
> **Open questions**
>
> - …

<!-- /dfai-lite:summary -->
```

- The title carries who wrote it and when: your exact model id (for example
  `claude-sonnet-5-5`) and today's date. That, with the marker, is how the
  next run knows the note is done.
- Plain `- ` bullets only. **Never `- [ ]`**: a checkbox reads as one of
  James's own to-dos. Owners go after a colon, as written in the note.
- **No `[[wikilinks]]`** in the block: the note's own lines already link the
  people and projects.
- Leave out a heading with nothing under it. About 1,500 characters at most.
- Only what the note says. Never guess an owner, a date or a decision.
- The closing marker is its own line, outside the callout (after a blank
  line), so the callout ends before it.

## 4. Never change

Everything outside the block stays byte for byte: the first sentence, the
`- When:` lines, `## Summary`, `## Notes`, James's own lines, and above all
the `## Transcript`. Do not tidy, reorder or correct any of it, even a typo.

## Worked example

The queue holds:

```markdown
- [[Meetings/2026/11/2026-11-17 Larkspur Payroll renewal]] added 2026-11-17
```

The note before:

```markdown
Renewal call with Larkspur Payroll. #meeting

- When: 2026-11-17 09:30–10:15
- With: [[Mara Quill]], [[Tobias Fenn]]
- Source: https://notes.granola.ai/d/example

## Notes

Rate stays flat if we sign for two years.

## Transcript

**Mara Quill** [00:00:04] Can we keep the current rate?
**Tobias Fenn** [00:00:09] For two years, yes. I'll flag the cache issue before Friday.
```

The note after (only the block is new):

```markdown
Renewal call with Larkspur Payroll. #meeting

- When: 2026-11-17 09:30–10:15
- With: [[Mara Quill]], [[Tobias Fenn]]
- Source: https://notes.granola.ai/d/example

<!-- dfai-lite:summary v1 -->

> [!summary] Summary by Claude (claude-sonnet-5-5, 2026-11-24)
> Mara Quill and Tobias Fenn agreed the Larkspur Payroll renewal: the rate
> stays flat on a two-year term.
>
> **Decisions**
>
> - Renew for two years at the current rate
>
> **Action items**
>
> - Flag the cache issue before Friday: Tobias Fenn

<!-- /dfai-lite:summary -->

## Notes

Rate stays flat if we sign for two years.

## Transcript

**Mara Quill** [00:00:04] Can we keep the current rate?
**Tobias Fenn** [00:00:09] For two years, yes. I'll flag the cache issue before Friday.
```

Then the line is removed from the queue, and both files are saved (section 2a).
