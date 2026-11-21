//! The vault's files: read all in one call, and guarded writes, renames and
//! deletes, every one confined to the chosen vault folder.

use std::fs;
use std::io::{ErrorKind, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::lock;
use crate::watcher::{self, VaultWatcher};

/// The error prefix TypeScript reads as "the file is not the text you last saw".
const CHANGED: &str = "changed:";
/// The error prefix TypeScript reads as "a file is already at that path".
const EXISTS: &str = "exists:";
/// A write goes to this name beside the file first, then is renamed over it.
pub const TEMP_SUFFIX: &str = ".dfai-lite-tmp";
/// The one dot folder that is read: the app's own synced files.
const APP_FOLDER: &str = ".dfai-lite";

/// The vault folder chosen in the app, canonical. Every path is under it.
#[derive(Default)]
pub struct VaultRoot(Mutex<Option<PathBuf>>);

impl VaultRoot {
    pub fn get(&self) -> Result<PathBuf, String> {
        lock(&self.0)
            .clone()
            .ok_or_else(|| "no vault folder is open".to_string())
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
}

/// `relative` under `root`, or why not: plain `/`-separated parts, none of
/// them empty, `.`, `..` or `.git`, and none that is a symbolic link, so no
/// path the webview sends can reach outside the vault or into git's own files.
pub fn inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let refused = || format!("{relative:?} is not a path inside the vault");
    if relative.is_empty() || relative.contains(['\0', '\\']) || relative.starts_with('/') {
        return Err(refused());
    }
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        if part.is_empty() || part == "." || part == ".." || part == ".git" {
            return Err(refused());
        }
        path.push(part);
        let is_link = path
            .symlink_metadata()
            .is_ok_and(|meta| meta.file_type().is_symlink());
        if is_link {
            return Err(refused());
        }
    }
    Ok(path)
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

/// Every file under `root`: notes with their text, the rest by path, each sorted.
pub fn snapshot(root: &Path) -> Result<VaultSnapshot, String> {
    let mut found = VaultSnapshot::default();
    walk(root, "", &mut found)?;
    found.notes.sort_by(|a, b| a.path.cmp(&b.path));
    found.other_paths.sort();
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

/// The file's text, or None when there is no file.
pub fn read(root: &Path, path: &str) -> Result<Option<String>, String> {
    match fs::read_to_string(inside(root, path)?) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("cannot read {path}: {error}")),
    }
}

/// Writes `text` at `path` only while the file holds `expected`; with no
/// `expected`, only when there is no file there yet (never over one).
pub fn write(root: &Path, path: &str, text: &str, expected: Option<&str>) -> Result<(), String> {
    let target = inside(root, path)?;
    let Some(expected) = expected else {
        return create_new(&target, path, text);
    };
    if read(root, path)?.as_deref() != Some(expected) {
        return Err(format!("{CHANGED} {path} changed since it was read"));
    }
    let temp = target.with_file_name(format!(
        "{}{TEMP_SUFFIX}",
        target.file_name().unwrap_or_default().to_string_lossy()
    ));
    fs::write(&temp, text).map_err(|error| format!("cannot write {path}: {error}"))?;
    fs::rename(&temp, &target).map_err(|error| format!("cannot write {path}: {error}"))
}

fn create_new(target: &Path, path: &str, text: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("cannot make a folder: {error}"))?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|error| match error.kind() {
            ErrorKind::AlreadyExists => format!("{EXISTS} a file is already at {path}"),
            _ => format!("cannot create {path}: {error}"),
        })?;
    file.write_all(text.as_bytes())
        .map_err(|error| format!("cannot write {path}: {error}"))
}

/// Moves `from` to `to`, never over another file. A change of case alone
/// (`a.md` to `A.md`) is the same file on a Mac's disk, and is allowed.
pub fn rename(root: &Path, from: &str, to: &str) -> Result<(), String> {
    let source = inside(root, from)?;
    let target = inside(root, to)?;
    let source_meta = source
        .symlink_metadata()
        .map_err(|error| format!("cannot move {from}: {error}"))?;
    if let Ok(target_meta) = target.symlink_metadata() {
        let same = target_meta.ino() == source_meta.ino() && target_meta.dev() == source_meta.dev();
        if !same {
            return Err(format!("{EXISTS} a file is already at {to}"));
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("cannot make a folder: {error}"))?;
    }
    fs::rename(&source, &target).map_err(|error| format!("cannot move {from}: {error}"))
}

/// Moves the file to the Trash; deletes it where there is no Trash to use.
pub fn delete(root: &Path, path: &str) -> Result<(), String> {
    let target = inside(root, path)?;
    if to_trash(&target).is_ok() {
        return Ok(());
    }
    fs::remove_file(&target).map_err(|error| format!("cannot delete {path}: {error}"))
}

#[cfg(target_os = "macos")]
fn to_trash(target: &Path) -> Result<(), trash::Error> {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};
    // The Finder method asks for permission to script Finder; this one does not.
    let mut context = trash::TrashContext::default();
    context.set_delete_method(DeleteMethod::NsFileManager);
    context.delete(target)
}

#[cfg(not(target_os = "macos"))]
fn to_trash(target: &Path) -> Result<(), trash::Error> {
    trash::delete(target)
}

/// Opens the folder as the vault, and starts watching it.
#[tauri::command]
pub fn open_vault(
    app: AppHandle,
    root: State<'_, VaultRoot>,
    watching: State<'_, VaultWatcher>,
    folder: String,
) -> Result<(), String> {
    let canonical = Path::new(&folder)
        .canonicalize()
        .map_err(|error| format!("cannot open {folder}: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("{folder} is not a folder"));
    }
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
pub fn read_file(root: State<'_, VaultRoot>, path: String) -> Result<Option<String>, String> {
    read(&root.get()?, &path)
}

#[tauri::command]
pub fn write_file(
    root: State<'_, VaultRoot>,
    path: String,
    text: String,
    expected: Option<String>,
) -> Result<(), String> {
    write(&root.get()?, &path, &text, expected.as_deref())
}

#[tauri::command]
pub fn rename_file(root: State<'_, VaultRoot>, from: String, to: String) -> Result<(), String> {
    rename(&root.get()?, &from, &to)
}

#[tauri::command]
pub fn delete_file(root: State<'_, VaultRoot>, path: String) -> Result<(), String> {
    delete(&root.get()?, &path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_folder;
    use std::os::unix::fs::symlink;

    #[test]
    fn a_plain_relative_path_is_inside() {
        let root = temp_folder();
        assert_eq!(
            inside(&root, "Inbox/Mara Quill.md"),
            Ok(root.join("Inbox").join("Mara Quill.md"))
        );
        assert!(inside(&root, "-x.md").is_ok());
        assert!(inside(&root, "Notes/résumé ✓.md").is_ok());
    }

    #[test]
    fn a_path_that_could_escape_is_refused() {
        let root = temp_folder();
        for path in [
            "",
            "/etc/passwd",
            "../outside.md",
            "Inbox/../../outside.md",
            "Inbox//x.md",
            "./x.md",
            ".git/config",
            "Inbox/.git/x",
            "a\\b.md",
            "nul\0.md",
        ] {
            assert!(inside(&root, path).is_err(), "{path:?} was let through");
        }
    }

    #[test]
    fn a_symbolic_link_anywhere_on_the_path_is_refused() {
        let root = temp_folder();
        let outside = temp_folder();
        symlink(&outside, root.join("Linked")).unwrap();
        symlink(outside.join("x.md"), root.join("note.md")).unwrap();
        assert!(inside(&root, "Linked/x.md").is_err());
        assert!(inside(&root, "note.md").is_err());
        assert!(write(&root, "Linked/x.md", "escaped", None).is_err());
        assert!(!outside.join("x.md").exists());
    }

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
    }

    #[test]
    fn a_write_needs_the_text_last_seen_and_a_create_never_overwrites() {
        let root = temp_folder();
        write(&root, "Inbox/Larkspur.md", "one", None).unwrap();
        let again = write(&root, "Inbox/Larkspur.md", "two", None).unwrap_err();
        assert!(again.starts_with(EXISTS), "{again}");
        let stale = write(&root, "Inbox/Larkspur.md", "two", Some("zero")).unwrap_err();
        assert!(stale.starts_with(CHANGED), "{stale}");
        write(&root, "Inbox/Larkspur.md", "two", Some("one")).unwrap();
        assert_eq!(
            read(&root, "Inbox/Larkspur.md"),
            Ok(Some("two".to_string()))
        );
        let gone = write(&root, "Inbox/Missing.md", "x", Some("y")).unwrap_err();
        assert!(gone.starts_with(CHANGED), "{gone}");
    }

    #[test]
    fn a_rename_never_overwrites_but_may_change_case() {
        let root = temp_folder();
        write(&root, "a.md", "a", None).unwrap();
        write(&root, "b.md", "b", None).unwrap();
        assert!(rename(&root, "a.md", "b.md")
            .unwrap_err()
            .starts_with(EXISTS));
        rename(&root, "a.md", "Moved/A.md").unwrap();
        assert_eq!(read(&root, "Moved/A.md"), Ok(Some("a".to_string())));
        rename(&root, "Moved/A.md", "Moved/a.md").unwrap();
        assert_eq!(read(&root, "Moved/a.md"), Ok(Some("a".to_string())));
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
        println!("read 2,000 notes in {took:?}");
    }

    #[test]
    fn a_missing_file_reads_as_none() {
        let root = temp_folder();
        assert_eq!(read(&root, "nothing.md"), Ok(None));
    }
}
