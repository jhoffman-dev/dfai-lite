//! Guarded file operations on paths already confined to the vault: a write
//! only over the text last seen, a create or a move never over another file,
//! a delete only of the text last seen.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// The error prefix TypeScript reads as "the file is not the text you last saw".
pub const CHANGED: &str = "changed:";
/// The error prefix TypeScript reads as "a file is already at that path".
pub const EXISTS: &str = "exists:";
/// The error prefix TypeScript reads as "the Trash would not take it".
pub const TRASH: &str = "trash:";
/// Every temporary file a write makes ends with this.
pub const TEMP_SUFFIX: &str = ".dfai-lite-tmp";
/// The empty file a new folder is made with, so git (which carries files, not
/// folders) takes it to the other Mac while it is empty. TypeScript hides it.
pub const KEEP_FILE: &str = ".gitkeep";
/// What a folder may hold and still be removed as empty: its keep file, and Finder's.
const DISPOSABLE_FILES: [&str; 2] = [KEEP_FILE, ".DS_Store"];

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

/// The file's text, or None when there is none.
pub fn read_text(target: &Path, label: &str) -> Result<Option<String>, String> {
    match fs::read_to_string(target) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("cannot read {label}: {error}")),
    }
}

/// Writes `text` only while the file holds `expected`; with no `expected`,
/// only when there is no file yet.
pub fn write_guarded(
    target: &Path,
    label: &str,
    text: &str,
    expected: Option<&str>,
) -> Result<(), String> {
    let Some(expected) = expected else {
        return create_new(target, label, text);
    };
    if read_text(target, label)?.as_deref() != Some(expected) {
        return Err(format!("{CHANGED} {label} changed since it was read"));
    }
    replace(target, label, text)
}

fn make_parent(target: &Path) -> Result<(), String> {
    match target.parent() {
        Some(parent) => {
            fs::create_dir_all(parent).map_err(|error| format!("cannot make a folder: {error}"))
        }
        None => Ok(()),
    }
}

/// Opens a new file, never one already there and never through a link.
fn open_new(path: &Path) -> std::io::Result<fs::File> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

fn create_new(target: &Path, label: &str, text: &str) -> Result<(), String> {
    make_parent(target)?;
    let mut file = open_new(target).map_err(|error| match error.kind() {
        ErrorKind::AlreadyExists => format!("{EXISTS} a file is already at {label}"),
        _ => format!("cannot create {label}: {error}"),
    })?;
    file.write_all(text.as_bytes())
        .map_err(|error| format!("cannot write {label}: {error}"))
}

/// A temporary name beside `target` no other write uses: `.<name>.<pid>.<n>.dfai-lite-tmp`.
fn temp_beside(target: &Path) -> PathBuf {
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let at = NEXT_TEMP.fetch_add(1, Ordering::SeqCst);
    target.with_file_name(format!(".{name}.{}.{at}{TEMP_SUFFIX}", std::process::id()))
}

/// Writes beside, then renames over, so a crash never leaves half a note.
fn replace(target: &Path, label: &str, text: &str) -> Result<(), String> {
    let temp = temp_beside(target);
    let written = open_new(&temp).and_then(|mut file| file.write_all(text.as_bytes()));
    let moved = written.and_then(|()| fs::rename(&temp, target));
    moved.map_err(|error| {
        // Gone already, or never made: either way nothing is left behind.
        let _ = fs::remove_file(&temp);
        format!("cannot write {label}: {error}")
    })
}

/// Moves `source` to `target`, never over another file, atomically. A change
/// of case alone (`a.md` to `A.md`) is the same file on a Mac's disk.
pub fn rename_no_replace(source: &Path, target: &Path, label: &str) -> Result<(), String> {
    let source_meta = source
        .symlink_metadata()
        .map_err(|error| format!("cannot move {label}: {error}"))?;
    let same_file = target
        .symlink_metadata()
        .is_ok_and(|meta| meta.ino() == source_meta.ino() && meta.dev() == source_meta.dev());
    make_parent(target)?;
    let moved = if same_file {
        fs::rename(source, target)
    } else {
        rename_exclusive(source, target)
    };
    moved.map_err(|error| match error.kind() {
        ErrorKind::AlreadyExists => format!("{EXISTS} a file is already at {label}"),
        _ => format!("cannot move {label}: {error}"),
    })
}

#[cfg(target_os = "macos")]
fn rename_exclusive(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let c = |path: &Path| CString::new(path.as_os_str().as_bytes()).map_err(std::io::Error::other);
    let (from, to) = (c(source)?, c(target)?);
    // SAFETY: both are NUL-terminated paths we own for the length of the call.
    let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

/// Elsewhere (Linux, for CI): a link fails when the name is taken, then the old name goes.
#[cfg(not(target_os = "macos"))]
fn rename_exclusive(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::hard_link(source, target)?;
    fs::remove_file(source)
}

/// Deletes the file only while it holds `expected`: to the Trash, or for
/// good when `permanently`. A Trash that refuses is an error, never a
/// silent permanent delete.
pub fn delete_guarded(
    target: &Path,
    label: &str,
    expected: Option<&str>,
    permanently: bool,
) -> Result<(), String> {
    if let Some(expected) = expected {
        if read_text(target, label)?.as_deref() != Some(expected) {
            return Err(format!("{CHANGED} {label} changed since it was read"));
        }
    }
    if permanently {
        return fs::remove_file(target).map_err(|error| format!("cannot delete {label}: {error}"));
    }
    to_trash(target).map_err(|error| format!("{TRASH} the Trash would not take {label}: {error}"))
}

/// Makes the folder (and any missing above it) with an empty keep file in
/// it, never where a file or folder already is (case aside, on a Mac).
pub fn create_folder(target: &Path, label: &str) -> Result<(), String> {
    make_parent(target)?;
    fs::create_dir(target).map_err(|error| match error.kind() {
        ErrorKind::AlreadyExists => format!("{EXISTS} something is already at {label}"),
        _ => format!("cannot make the folder {label}: {error}"),
    })?;
    open_new(&target.join(KEEP_FILE))
        .map(drop)
        .map_err(|error| format!("cannot make the folder {label}: {error}"))
}

/// Removes a folder that holds nothing but disposable files, and those
/// files; refuses, removing nothing, when it holds anything else.
pub fn remove_empty_folder(target: &Path, label: &str) -> Result<(), String> {
    let entries = fs::read_dir(target).map_err(|error| format!("cannot read {label}: {error}"))?;
    let mut disposable = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("cannot read {label}: {error}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_file = entry.file_type().is_ok_and(|kind| kind.is_file());
        if !is_file || !DISPOSABLE_FILES.contains(&name.as_str()) {
            return Err(format!("{label} is not empty"));
        }
        disposable.push(entry.path());
    }
    for file in disposable {
        fs::remove_file(file).map_err(|error| format!("cannot remove {label}: {error}"))?;
    }
    fs::remove_dir(target).map_err(|error| format!("cannot remove {label}: {error}"))
}

#[cfg(target_os = "macos")]
fn to_trash(target: &Path) -> Result<(), String> {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};
    // The Finder method asks for permission to script Finder; this one does not.
    let mut context = trash::TrashContext::default();
    context.set_delete_method(DeleteMethod::NsFileManager);
    context.delete(target).map_err(|error| error.to_string())
}

/// The app runs on the Mac only. Elsewhere (the Linux check) there is no Trash
/// to use, so a delete is refused the way a full or missing Trash refuses it.
#[cfg(not(target_os = "macos"))]
fn to_trash(_target: &Path) -> Result<(), String> {
    Err("there is no Trash on this system".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_folder;
    use std::os::unix::fs::symlink;

    #[test]
    fn a_write_needs_the_text_last_seen_and_a_create_never_overwrites() {
        let root = temp_folder();
        let note = root.join("Inbox").join("Larkspur.md");
        write_guarded(&note, "note", "one", None).unwrap();
        assert!(write_guarded(&note, "note", "two", None)
            .unwrap_err()
            .starts_with(EXISTS));
        assert!(write_guarded(&note, "note", "two", Some("zero"))
            .unwrap_err()
            .starts_with(CHANGED));
        write_guarded(&note, "note", "two", Some("one")).unwrap();
        assert_eq!(read_text(&note, "note"), Ok(Some("two".to_string())));
        let gone = root.join("Missing.md");
        assert!(write_guarded(&gone, "note", "x", Some("y"))
            .unwrap_err()
            .starts_with(CHANGED));
    }

    #[test]
    fn a_write_never_follows_a_link_planted_at_a_temporary_name() {
        let root = temp_folder();
        let outside = temp_folder();
        let note = root.join("Note.md");
        fs::write(&note, "old").unwrap();
        // The name the first version wrote its temporary file at.
        symlink(
            outside.join("stolen.md"),
            root.join("Note.md.dfai-lite-tmp"),
        )
        .unwrap();
        write_guarded(&note, "note", "new", Some("old")).unwrap();
        assert_eq!(fs::read_to_string(&note).unwrap(), "new");
        assert!(!outside.join("stolen.md").exists());
        let left: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(".Note.md."))
            .collect();
        assert!(left.is_empty(), "temporary files left: {left:?}");
    }

    #[test]
    fn a_rename_never_overwrites_but_may_change_case() {
        let root = temp_folder();
        let (a, b) = (root.join("a.md"), root.join("b.md"));
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        assert!(rename_no_replace(&a, &b, "b.md")
            .unwrap_err()
            .starts_with(EXISTS));
        assert_eq!(fs::read_to_string(&b).unwrap(), "b");
        let moved = root.join("Moved").join("A.md");
        rename_no_replace(&a, &moved, "A.md").unwrap();
        let lower = root.join("Moved").join("a.md");
        rename_no_replace(&moved, &lower, "a.md").unwrap();
        assert_eq!(fs::read_to_string(&lower).unwrap(), "a");
    }

    #[test]
    fn a_delete_refuses_a_file_changed_since_it_was_read() {
        let root = temp_folder();
        let note = root.join("Note.md");
        fs::write(&note, "changed by Claude").unwrap();
        let refused = delete_guarded(&note, "note", Some("what I saw"), true).unwrap_err();
        assert!(refused.starts_with(CHANGED), "{refused}");
        assert!(note.exists());
        delete_guarded(&note, "note", Some("changed by Claude"), true).unwrap();
        assert!(!note.exists());
    }

    #[test]
    fn a_new_folder_holds_a_keep_file_and_never_lands_on_anything() {
        let root = temp_folder();
        let folder = root.join("Areas").join("Garden");
        create_folder(&folder, "Areas/Garden").unwrap();
        assert!(folder.join(KEEP_FILE).is_file());
        let again = create_folder(&folder, "Areas/Garden").unwrap_err();
        assert!(again.starts_with(EXISTS), "{again}");
        fs::write(root.join("Plan"), "x").unwrap();
        assert!(create_folder(&root.join("Plan"), "Plan")
            .unwrap_err()
            .starts_with(EXISTS));
        assert_eq!(fs::read_to_string(root.join("Plan")).unwrap(), "x");
    }

    #[test]
    fn only_a_folder_holding_nothing_but_disposable_files_is_removed() {
        let root = temp_folder();
        let folder = root.join("Areas");
        create_folder(&folder, "Areas").unwrap();
        fs::write(folder.join(".DS_Store"), "x").unwrap();
        fs::write(folder.join("note.md"), "keep me").unwrap();
        assert!(remove_empty_folder(&folder, "Areas").is_err());
        assert!(folder.join("note.md").is_file());
        assert!(folder.join(KEEP_FILE).is_file());
        fs::remove_file(folder.join("note.md")).unwrap();
        fs::create_dir(folder.join("Inner")).unwrap();
        assert!(remove_empty_folder(&folder, "Areas").is_err());
        fs::remove_dir(folder.join("Inner")).unwrap();
        remove_empty_folder(&folder, "Areas").unwrap();
        assert!(!folder.exists());
    }
}
