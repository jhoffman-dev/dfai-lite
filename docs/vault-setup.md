# Setting up a vault

A DFAI Lite vault is a private GitHub repo, cloned to your Mac, that the app syncs with your Mac's own `git` and Claude reads.

## 1. Make the private repo

The template is a folder in the public DFAI Lite repo, so copy it rather than using GitHub's "Use this template":

```sh
gh repo create notes --private          # any name; keep it private
git clone https://github.com/<you>/notes.git ~/Notes
cp -R vault-template/. ~/Notes/          # run from a DFAI Lite checkout
cd ~/Notes
git add -A && git commit -m "Vault: start from the DFAI Lite template" && git push -u origin main
```

Coming from DFAI? Skip the `cp` and migrate instead (step 5).

## 2. Open it in the app

Start DFAI Lite and choose `~/Notes` as your notes folder (Settings → Notes folder → Change… to switch later). There is no token: the app runs `git`, which uses the login it already has. Check that `git pull` and `git push` work in that folder in Terminal without a prompt; if they ask for a password, set up the GitHub CLI (`gh auth login`, which installs a credential helper) or an SSH key first.

On another Mac, `git clone` the same repo and choose that folder. Each Mac commits, merges and pushes on its own; a note both changed keeps both versions.

## 3. Turn on the index Action

`.github/workflows/index.yml` rebuilds `_index/` when anyone but the app pushes (Claude, an edit on github.com), and after every push writes the map in the vault's `README.md` (between its markers; the rest of the file is yours) and `.dfai-lite/search.mjs`, the search command Claude runs in the vault. In the repo:

- **Actions** tab → enable workflows if GitHub asks.
- **Settings → Actions → General → Workflow permissions:** if the Action's push fails with a 403, choose "Read and write permissions".

It needs no secret: it checks out the public DFAI Lite repo for the index writer.

## 4. Get the README map and search into a vault you already have

From a DFAI Lite checkout (Node 22.18 or later), copy the newer Action into the vault and write the map and the search command once, then let the app (or `git`) push them:

```sh
cp vault-template/.github/workflows/index.yml ~/Notes/.github/workflows/index.yml
node tools/build-index.ts ~/Notes
```

If the vault has a `README.md`, its text is kept byte for byte and the map is added below it; move the map's markers anywhere you like. After that the Action keeps both current. Try it: `cd ~/Notes && node .dfai-lite/search.mjs "some words"`.

## 5. Migrate a DFAI vault

Needs Node 22.18 or later. From a DFAI Lite checkout, into a new empty folder (the DFAI vault is only read, never changed):

```sh
node tools/migrate-from-dfai.ts ~/path/to/dfai-vault ~/Notes-new
```

It strips frontmatter (tags become inline `#tags`, other properties a `- Key: value` list, favorites go to `.dfai-lite/favorites.json`), moves meetings to `Meetings/<YYYY>/<MM>/` and people to `People/`, adds `CLAUDE.md`, `README.md` and the Action, writes `_index/`, the README map and the search command, and prints every property it dropped and every name clash. Read the report, then push the folder to the private repo and choose it in the app:

```sh
cd ~/Notes-new
git init -b main && git add -A && git commit -m "Vault: migrated from DFAI"
git remote add origin https://github.com/<you>/notes.git && git push -u origin main
```

To rebuild the index, the README map and the search command by hand at any time: `node tools/build-index.ts ~/Notes`.
