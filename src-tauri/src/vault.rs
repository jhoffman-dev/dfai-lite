//! The vault's files: read all in one call, guarded writes, renames and
//! deletes, every one confined to the chosen vault folder, and the scan for
//! what git must not be given.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::files::{self, TEMP_SUFFIX};
use crate::lock;
use crate::paths::{inside, APP_FOLDER};
use crate::watcher::{self, VaultWatcher};

/// The ignore file the sync keeps its own block in, at the vault's top.
const IGNORE_FILE: &str = ".gitignore";
/// GitHub refuses a push holding a file this large.
const TOO_LARGE_BYTES: u64 = 100 * 1024 * 1024;

/// The vault folder chosen in the app, canonical. Every path is under it.
#[derive(Default)]
pub struct VaultRoot(Mutex<Option<PathBuf>>);

impl VaultRoot {
    pub fn get(&self) -> Result<PathBuf, String> {
        lock(&self.0)
            .clone()
            .ok_or_else(|| "no vault folder is open".to_string())
    }

    /// A root already open at `folder`, for tests of commands that need one.
    #[cfg(test)]
    pub fn open_at(folder: PathBuf) -> Self {
        Self(Mutex::new(Some(folder)))
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct NoteText {
    path: String,
    text: String,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshot {
    notes: Vec<NoteText>,
    other_paths: Vec<String>,
    /// Every folder the walk enters, empty or not.
    folders: Vec<String>,
}

/// What `git add --all` must not be given: files over GitHub's limit, and
/// folders that are git repositories of their own.
#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Unsyncable {
    too_large: Vec<String>,
    nested_repos: Vec<String>,
}

/// A folder the walk never enters: git's, packages, and dot folders but the app's own.
fn skipped_folder(name: &str) -> bool {
    name == "node_modules" || (name.starts_with('.') && name != APP_FOLDER)
}

/// Files read as text: markdown, and the app's own JSON under `.dfai-lite/`.
fn is_text_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || (path.starts_with(".dfai-lite/") && lower.ends_with(".json"))
}

/// Every file under `root`: notes with their text, the rest by path, and
/// every folder, each sorted.
pub fn snapshot(root: &Path) -> Result<VaultSnapshot, String> {
    let mut found = VaultSnapshot::default();
    walk(root, "", &mut found)?;
    found.notes.sort_by(|a, b| a.path.cmp(&b.path));
    found.other_paths.sort();
    found.folders.sort();
    Ok(found)
}

fn walk(folder: &Path, prefix: &str, found: &mut VaultSnapshot) -> Result<(), String> {
    let entries = fs::read_dir(folder).map_err(|error| format!("cannot read a folder: {error}"))?;
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = format!("{prefix}{name}");
        if kind.is_dir() && !skipped_folder(&name) {
            walk(&entry.path(), &format!("{path}/"), found)?;
            found.folders.push(path);
        } else if kind.is_file() && !name.ends_with(TEMP_SUFFIX) {
            // A note that is not UTF-8 is listed, not read: it cannot be shown as text.
            match is_text_path(&path).then(|| fs::read_to_string(entry.path())) {
                Some(Ok(text)) => found.notes.push(NoteText { path, text }),
                _ => found.other_paths.push(path),
            }
        }
    }
    Ok(())
}

/// Files over GitHub's limit and nested repositories, anywhere but in git's own folder.
pub fn unsyncable(root: &Path) -> Unsyncable {
    let mut found = Unsyncable::default();
    scan(root, "", &mut found);
    found.too_large.sort();
    found.nested_repos.sort();
    found
}

fn scan(folder: &Path, prefix: &str, found: &mut Unsyncable) {
    // An unreadable folder holds nothing git could be given either.
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.path().symlink_metadata() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = format!("{prefix}{name}");
        if meta.is_dir() {
            if prefix.is_empty() && name == ".git" {
                continue;
            }
            if entry.path().join(".git").symlink_metadata().is_ok() {
                found.nested_repos.push(path);
            } else {
                scan(&entry.path(), &format!("{path}/"), found);
            }
        } else if meta.is_file() && meta.len() > TOO_LARGE_BYTES {
            found.too_large.push(path);
        }
    }
}

/// Refuses the disk's root, the home folder and anything holding it: the
/// vault would be every file on the Mac.
fn vault_folder(folder: &str, home: Option<&Path>) -> Result<PathBuf, String> {
    let canonical = Path::new(folder)
        .canonicalize()
        .map_err(|error| format!("cannot open {folder}: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("{folder} is not a folder"));
    }
    let holds_home = home
        .and_then(|home| home.canonicalize().ok())
        .is_some_and(|home| home.starts_with(&canonical));
    if canonical.parent().is_none() || holds_home {
        return Err(format!(
            "{folder} holds your whole home folder; choose the folder your notes are in"
        ));
    }
    Ok(canonical)
}

/// Opens the folder as the vault, and starts watching it.
#[tauri::command]
pub fn open_vault(
    app: AppHandle,
    root: State<'_, VaultRoot>,
    watching: State<'_, VaultWatcher>,
    folder: String,
) -> Result<(), String> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let canonical = vault_folder(&folder, home.as_deref())?;
    watcher::watch(app, &watching, canonical.clone())?;
    *lock(&root.0) = Some(canonical);
    Ok(())
}

#[tauri::command]
pub async fn read_vault(root: State<'_, VaultRoot>) -> Result<VaultSnapshot, String> {
    let root = root.get()?;
    tauri::async_runtime::spawn_blocking(move || snapshot(&root))
        .await
        .map_err(|error| format!("the vault read did not finish: {error}"))?
}

#[tauri::command]
pub async fn find_unsyncable(root: State<'_, VaultRoot>) -> Result<Unsyncable, String> {
    let root = root.get()?;
    tauri::async_runtime::spawn_blocking(move || unsyncable(&root))
        .await
        .map_err(|error| format!("the vault scan did not finish: {error}"))
}

#[tauri::command]
pub fn read_file(root: State<'_, VaultRoot>, path: String) -> Result<Option<String>, String> {
    files::read_text(&inside(&root.get()?, &path)?, &path)
}

#[tauri::command]
pub fn write_file(
    root: State<'_, VaultRoot>,
    path: String,
    text: String,
    expected: Option<String>,
) -> Result<(), String> {
    let target = inside(&root.get()?, &path)?;
    files::write_guarded(&target, &path, &text, expected.as_deref())
}

#[tauri::command]
pub fn rename_file(root: State<'_, VaultRoot>, from: String, to: String) -> Result<(), String> {
    let root = root.get()?;
    files::rename_no_replace(&inside(&root, &from)?, &inside(&root, &to)?, &to)
}

/// Makes an empty folder with its keep file; dot names and paths out of the vault are refused.
#[tauri::command]
pub fn create_folder(root: State<'_, VaultRoot>, path: String) -> Result<(), String> {
    files::create_folder(&inside(&root.get()?, &path)?, &path)
}

/// Moves a folder whole; both paths confined to the vault, no dot names.
#[tauri::command]
pub fn rename_folder(root: State<'_, VaultRoot>, from: String, to: String) -> Result<(), String> {
    let root = root.get()?;
    files::rename_folder(&inside(&root, &from)?, &inside(&root, &to)?, &to)
}

/// Removes a folder holding nothing but its keep file (or Finder's `.DS_Store`).
#[tauri::command]
pub fn remove_folder(root: State<'_, VaultRoot>, path: String) -> Result<(), String> {
    files::remove_empty_folder(&inside(&root.get()?, &path)?, &path)
}

#[tauri::command]
pub fn delete_file(
    root: State<'_, VaultRoot>,
    path: String,
    expected: Option<String>,
    permanently: bool,
) -> Result<(), String> {
    let target = inside(&root.get()?, &path)?;
    files::delete_guarded(&target, &path, expected.as_deref(), permanently)
}

/// The vault's top `.gitignore`: the one dot file the app writes, through its own pair of commands.
#[tauri::command]
pub fn read_ignore_file(root: State<'_, VaultRoot>) -> Result<Option<String>, String> {
    files::read_text(&root.get()?.join(IGNORE_FILE), IGNORE_FILE)
}

#[tauri::command]
pub fn write_ignore_file(
    root: State<'_, VaultRoot>,
    text: String,
    expected: Option<String>,
) -> Result<(), String> {
    let target = root.get()?.join(IGNORE_FILE);
    if target
        .symlink_metadata()
        .is_ok_and(|meta| meta.file_type().is_symlink())
    {
        return Err(format!("{IGNORE_FILE} is a link"));
    }
    files::write_guarded(&target, IGNORE_FILE, &text, expected.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_folder;

    #[test]
    fn the_snapshot_reads_notes_and_lists_the_rest_skipping_git_and_dot_folders() {
        let root = temp_folder();
        for (path, text) in [
            ("Welcome.md", "Hello"),
            ("People/Tobias Fenn.md", "Engineer"),
            (".dfai-lite/favorites.json", "[]"),
            (".git/HEAD", "ref"),
            (".obsidian/x.md", "skip"),
            ("node_modules/x.md", "skip"),
            ("Images/plan.png", "png"),
            ("Inbox/.a.md.1.2.dfai-lite-tmp", "half"),
        ] {
            let file = root.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, text).unwrap();
        }
        let found = snapshot(&root).unwrap();
        let paths: Vec<_> = found.notes.iter().map(|note| note.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                ".dfai-lite/favorites.json",
                "People/Tobias Fenn.md",
                "Welcome.md"
            ]
        );
        assert_eq!(found.notes[1].text, "Engineer");
        assert_eq!(found.other_paths, ["Images/plan.png"]);
        assert_eq!(found.folders, [".dfai-lite", "Images", "Inbox", "People"]);
    }

    #[test]
    fn an_empty_folder_is_listed_with_the_same_skips_as_files() {
        let root = temp_folder();
        for folder in [
            "Areas/Garden",
            ".obsidian/plugins",
            "node_modules/x",
            "Inbox",
        ] {
            fs::create_dir_all(root.join(folder)).unwrap();
        }
        let found = snapshot(&root).unwrap();
        assert_eq!(found.folders, ["Areas", "Areas/Garden", "Inbox"]);
        assert!(found.notes.is_empty());
    }

    #[test]
    fn a_folder_is_made_only_inside_the_vault_and_never_with_a_dot_name() {
        let root = temp_folder();
        for path in [
            "../outside",
            "/tmp/x",
            ".hidden",
            "Areas/.git",
            ".git/x",
            "Areas//x",
            "",
        ] {
            let refused =
                inside(&root, path).and_then(|target| files::create_folder(&target, path));
            assert!(refused.is_err(), "{path:?} was made");
        }
        let outside = temp_folder();
        std::os::unix::fs::symlink(&outside, root.join("Linked")).unwrap();
        assert!(inside(&root, "Linked/New").is_err());
        let target = inside(&root, "Areas/Garden").unwrap();
        files::create_folder(&target, "Areas/Garden").unwrap();
        assert_eq!(
            snapshot(&root).unwrap().other_paths,
            ["Areas/Garden/.gitkeep"]
        );
    }

    #[test]
    fn two_thousand_notes_read_in_one_call_well_under_a_second() {
        let root = temp_folder();
        let body = "Payroll notes with [[Mara Quill]] and #project/active.\n".repeat(40);
        for folder in 0..40 {
            let dir = root.join(format!("Folder {folder}"));
            fs::create_dir_all(&dir).unwrap();
            for note in 0..50 {
                fs::write(dir.join(format!("Note {note}.md")), &body).unwrap();
            }
        }
        let started = std::time::Instant::now();
        let found = snapshot(&root).unwrap();
        let took = started.elapsed();
        assert_eq!(found.notes.len(), 2_000);
        // Generous, so a slow CI runner never flakes; on a Mac it is a few tens of ms.
        assert!(took.as_millis() < 1_000, "read 2,000 notes in {took:?}");
    }

    #[test]
    fn the_scan_finds_nested_repositories_and_files_over_the_limit() {
        let root = temp_folder();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join("Code/tool/.git")).unwrap();
        fs::write(root.join("Code/tool/x.md"), "x").unwrap();
        let big = fs::File::create(root.join("video.mov")).unwrap();
        big.set_len(TOO_LARGE_BYTES + 1).unwrap();
        fs::write(root.join("small.md"), "x").unwrap();
        assert_eq!(
            unsyncable(&root),
            Unsyncable {
                too_large: vec!["video.mov".into()],
                nested_repos: vec!["Code/tool".into()],
            }
        );
    }

    #[test]
    fn the_disk_root_and_the_home_folder_are_refused_as_a_vault() {
        let home = temp_folder();
        let notes = home.join("Notes");
        fs::create_dir_all(&notes).unwrap();
        let home_text = home.to_string_lossy().into_owned();
        assert!(vault_folder("/", Some(&home)).is_err());
        assert!(vault_folder(&home_text, Some(&home)).is_err());
        let parent = home.parent().unwrap().to_string_lossy().into_owned();
        assert!(vault_folder(&parent, Some(&home)).is_err());
        assert_eq!(
            vault_folder(&notes.to_string_lossy(), Some(&home)),
            Ok(notes.canonicalize().unwrap())
        );
    }
}
