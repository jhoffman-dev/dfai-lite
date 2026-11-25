# Meeting notes into a vault from n8n

An n8n workflow reads each "Notes by Gemini" email and commits one meeting
note to the vault's GitHub repository, at
`Meetings/<YYYY>/<MM>/<YYYY-MM-DD> <title>.md`, in the shape the vault's
`CLAUDE.md` gives ("A meeting note"). If that file is already there, it is
the same meeting: the workflow adds what is new (a transcript arriving after
the summary) and leaves the rest of the note as it is. A transcript goes to
a note of its own, `Transcripts/<YYYY>/<MM>/<YYYY-MM-DD> <title> (transcript).md`,
which the meeting note links with a `- Transcript:` line.

| File                                 | What it is                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `meeting-note.bundle.js`             | The mapper and note writer as one script with no imports, for a Code node.       |
| `build-bundle.ts`                    | Rebuilds the bundle from `src/domain/meetings`: `node tools/n8n/build-bundle.ts` |
| `fixtures/gemini-larkspur-sync.json` | A fictional Gemini meeting, to try the bundle or the CLI on.                     |

The bundle defines one name, `dfaiMeetings`, with `fromGeminiNotes`,
`meetingNote`, `mergeMeetingNote`, `meetingWrite`, `meetingCommitMessage`,
`parseMeetingInput` and `MeetingInputError`. A test fails when the bundle is
behind its sources, so rebuild and commit it after changing them.

To try a meeting without n8n:
`node tools/meeting-note.ts <vault dir> tools/n8n/fixtures/gemini-larkspur-sync.json --gemini`.

## 1. A token that can write to the vault only

GitHub → **Settings → Developer settings → Fine-grained tokens → Generate**:
**Repository access: Only select repositories** → the vault repository, and
**Repository permissions: Contents → Read and write**. Nothing else (GitHub
adds Metadata read-only by itself). Store it only in n8n: **Credentials → Add
credential → GitHub API**, with the token as the Access Token.

## 2. The flow

1. **Gmail Trigger** on the "Notes by Gemini" emails, then the steps that
   assemble one item per meeting with the fields DFAI's workflow already
   uses: `subject` (the email's subject, or the doc's title: it states the
   day, and the start when given), `title` (optional), `attendees` (a list of
   `{ name, email }`, or `Name — email` lines), `summaryMd` (the notes, with
   `## Summary`, `## Decisions`, `## Next steps`, `## Details` headings),
   `transcriptMd` and `url`.
2. **Code node "Meeting note"** (Run Once for Each Item): paste the whole
   bundle, then
   ```js
   const input = dfaiMeetings.fromGeminiNotes($json);
   const { path, text } = dfaiMeetings.meetingNote(input);
   return { json: { input, path, text, message: dfaiMeetings.meetingCommitMessage(input) } };
   ```
   A subject with no date in it throws: n8n shows why, and nothing is written.
3. **GitHub node: File → Get**, File Path `{{ $json.path }}`, **As Binary
   Property** off. Under Settings, **On Error → Continue**: a new meeting's
   file does not exist yet, and the 404 is expected.
4. **Code node "Merge"** (Run Once for All Items): paste the bundle again, then
   ```js
   const base64 = (text) => Buffer.from(text, 'utf8').toString('base64');
   return $input.all().flatMap((item, index) => {
     const note = $('Meeting note').itemMatching(index).json;
     const found = typeof item.json.content === 'string';
     const existing = found ? Buffer.from(item.json.content, 'base64').toString('utf8') : '';
     const { text, transcript } = dfaiMeetings.meetingWrite(existing, note.input, {
       path: note.path,
     });
     if (found && text === existing) return []; // nothing new: no commit
     return [
       {
         json: {
           message: note.message,
           path: note.path,
           content: base64(text),
           sha: item.json.sha,
           transcriptPath: transcript === null ? null : transcript.path,
           transcriptContent: transcript === null ? null : base64(transcript.text),
         },
       },
     ];
   });
   ```
5. **IF node "Has transcript"**: `{{ $json.transcriptPath !== null }}`. True
   goes to step 6; false goes straight to step 8.
6. **HTTP Request node "Create transcript"**: `PUT
https://api.github.com/repos/<owner>/<vault repo>/contents/{{ $json.transcriptPath.split('/').map(encodeURIComponent).join('/') }}`,
   Authentication **Predefined Credential Type → GitHub API**, JSON body
   `{{ JSON.stringify({ message: $json.message, content: $json.transcriptContent }) }}`.
   No `sha`, so GitHub only creates: a transcript note already there is
   refused with **422**, never overwritten. Under Settings, **On Error →
   Continue (using error output)**. Its success output goes to step 8, its
   error output to step 7.
7. **IF node "Already there"**: true only when the error is GitHub's 422
   (the transcript note exists, so the meeting note may link it): compare
   the HTTP status in the error item to `422` (open one failed run's output
   to see the field n8n puts it in). True goes to step 8; false goes to a
   **Stop and Error** node: a 502, a rate limit or a dropped connection
   stops here, so the meeting note is never written linking a transcript
   that is not there, and the next run tries both again.
8. **HTTP Request node "Write meeting"**: `PUT
https://api.github.com/repos/<owner>/<vault repo>/contents/{{ $('Merge').item.json.path.split('/').map(encodeURIComponent).join('/') }}`,
   same authentication, JSON body
   `{{ JSON.stringify({ message: $('Merge').item.json.message, content: $('Merge').item.json.content, sha: $('Merge').item.json.sha }) }}`
   (read from "Merge": the item arriving from step 7 is an error item). Leave
   On Error at its default, stop. The commit message is `Meeting: <date>

<title>`. With no `sha` GitHub only creates: if the Get failed for another
   reason and the file does exist, the PUT is refused rather than overwriting
   the note.

After the push, the vault's own `index` workflow (`.github/workflows/index.yml`)
rewrites `_index/`, so the meeting shows in `_index/meetings/<YYYY>-<MM>.md`
within a minute or two. The Mac app pulls it on its next sync.

## What the mapper reads

- **Day and start** from `subject`: the last date in it (`Nov 20, 2026`,
  `November 20 2026`, `2026/11/20`, `2026-11-20`) and a time right after it
  (`10:00`, `2:30 PM`), written as stated. A zone after the time is dropped,
  not converted. The title is the words before that date, without
  `Notes:` and quotes, unless `title` is given.
- **People**: each attendee once by address, a display name winning. One
  without a name is linked by the address's local part. Lists such as
  `payroll-team@…` are left out: they are not people.
- **Notes**: text before the first heading is the summary; `Details` become
  `## Notes`; a next step's `[Tobias Fenn]` owner becomes `[[Tobias Fenn]]`.
- **Transcript**: `Speaker: words` lines under `### hh:mm:ss` stamps; a line
  starting `Note:`, `URL:`, `Action item:` and the like continues the turn
  before. The `📖 Transcript`, date and "Transcription ended" lines are dropped.
