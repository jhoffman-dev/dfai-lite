//! Which relative paths the webview may name. Shapes only: no rules about
//! notes live here.

use std::path::{Path, PathBuf};

/// The one dot folder a note command may touch: the app's own synced files.
pub const APP_FOLDER: &str = ".dfai-lite";

/// The parts of a plain relative path: `/`-separated, none empty, `.` or `..`.
fn plain_parts(relative: &str) -> Result<Vec<&str>, String> {
    let refused = || format!("{relative:?} is not a path inside the vault");
    if relative.is_empty() || relative.contains(['\0', '\\']) || relative.starts_with('/') {
        return Err(refused());
    }
    let parts: Vec<&str> = relative.split('/').collect();
    if parts
        .iter()
        .any(|part| part.is_empty() || *part == "." || *part == "..")
    {
        return Err(refused());
    }
    Ok(parts)
}

/// Whether a part names git's own folder on a disk that ignores case: `.git`, `.GIT`, `.Git`.
fn is_git_folder(part: &str) -> bool {
    part.eq_ignore_ascii_case(".git")
}

/// `relative` under `root`, for the note commands, or why not: a plain
/// relative path with no part that is a symbolic link and no dot-named part
/// (git's folder in any case, `.gitattributes`, an editor's settings) other
/// than the app's own `.dfai-lite/` at the top.
pub fn inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let parts = plain_parts(relative)?;
    let mut path = root.to_path_buf();
    for (at, part) in parts.iter().enumerate() {
        let allowed_dot = at == 0 && *part == APP_FOLDER;
        if part.starts_with('.') && !allowed_dot {
            return Err(format!("{relative:?} is not a note path the app may touch"));
        }
        path.push(part);
        let is_link = path
            .symlink_metadata()
            .is_ok_and(|meta| meta.file_type().is_symlink());
        if is_link {
            return Err(format!("{relative:?} passes through a link"));
        }
    }
    Ok(path)
}

/// A path a git command may name: plain, relative, never into git's own folder.
pub fn git_path(relative: &str) -> Result<(), String> {
    let parts = plain_parts(relative)?;
    if parts.iter().any(|part| is_git_folder(part)) {
        return Err(format!("{relative:?} is inside git's own folder"));
    }
    Ok(())
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
        assert!(inside(&root, ".dfai-lite/favorites.json").is_ok());
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
            "a\\b.md",
            "nul\0.md",
        ] {
            assert!(inside(&root, path).is_err(), "{path:?} was let through");
            assert!(git_path(path).is_err(), "{path:?} was let through to git");
        }
    }

    #[test]
    fn git_s_folder_in_any_case_and_other_dot_paths_are_refused() {
        let root = temp_folder();
        for path in [
            ".git/config",
            ".GIT/config",
            ".Git/hooks/pre-commit",
            "Inbox/.git/config",
            "Inbox/.gIt/config",
            ".gitattributes",
            ".gitmodules",
            ".obsidian/workspace.md",
            "Inbox/.dfai-lite/x.json",
            ".DFAI-LITE/favorites.json",
        ] {
            assert!(inside(&root, path).is_err(), "{path:?} was let through");
        }
        for path in [".GIT/config", "Inbox/.Git/x"] {
            assert!(git_path(path).is_err(), "{path:?} was let through to git");
        }
        assert!(git_path(".gitignore").is_ok());
    }

    #[test]
    fn a_symbolic_link_anywhere_on_the_path_is_refused() {
        let root = temp_folder();
        let outside = temp_folder();
        symlink(&outside, root.join("Linked")).unwrap();
        symlink(outside.join("x.md"), root.join("note.md")).unwrap();
        assert!(inside(&root, "Linked/x.md").is_err());
        assert!(inside(&root, "note.md").is_err());
    }
}
