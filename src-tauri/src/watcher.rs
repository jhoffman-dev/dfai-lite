//! Tells the webview which vault files changed on disk: edits by Claude Code,
//! git, or another editor. Changes are gathered until the vault is quiet for a
//! moment, then sent as one `vault-changed` event of vault paths.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::files::TEMP_SUFFIX;
use crate::lock;

/// How long the vault must be quiet before the changes so far are sent.
const QUIET: Duration = Duration::from_millis(150);
pub const EVENT: &str = "vault-changed";

/// The watcher of the open vault. Replacing it stops the old one.
#[derive(Default)]
pub struct VaultWatcher(Mutex<Option<RecommendedWatcher>>);

pub fn watch(app: AppHandle, state: &VaultWatcher, root: PathBuf) -> Result<(), String> {
    let (send, receive) = channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        // A watcher error names no path; the next change is reported as usual.
        let Ok(event) = event else { return };
        for path in event.paths {
            // The batcher has stopped only when the watcher is being replaced.
            let _ = send.send(path);
        }
    })
    .map_err(|error| format!("cannot watch the vault: {error}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| format!("cannot watch the vault: {error}"))?;
    thread::spawn(move || send_batches(&app, &root, &receive));
    // The old watcher drops here, and with it its sender: its batcher ends.
    *lock(&state.0) = Some(watcher);
    Ok(())
}

fn send_batches(app: &AppHandle, root: &Path, receive: &Receiver<PathBuf>) {
    while let Ok(first) = receive.recv() {
        let mut paths = BTreeSet::new();
        paths.extend(relative(root, &first));
        let open = loop {
            match receive.recv_timeout(QUIET) {
                Ok(path) => paths.extend(relative(root, &path)),
                Err(RecvTimeoutError::Timeout) => break true,
                Err(RecvTimeoutError::Disconnected) => break false,
            }
        };
        if !paths.is_empty() {
            // The window may be closing; a lost event is read again on the next start.
            let _ = app.emit(EVENT, paths.into_iter().collect::<Vec<_>>());
        }
        if !open {
            return;
        }
    }
}

/// The vault path of a changed file, or None for git's own files, packages,
/// the vault folder itself, and a write's temporary file.
pub fn relative(root: &Path, path: &Path) -> Option<String> {
    let parts: Vec<String> = path
        .strip_prefix(root)
        .ok()?
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect();
    let first = parts.first()?;
    let skipped = first == ".git"
        || parts.iter().any(|part| part == "node_modules")
        || parts.last()?.ends_with(TEMP_SUFFIX);
    (!skipped).then(|| parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_note_is_reported_by_its_vault_path() {
        let root = Path::new("/vault");
        assert_eq!(
            relative(root, Path::new("/vault/People/Mara Quill.md")),
            Some("People/Mara Quill.md".to_string())
        );
    }

    #[test]
    fn git_packages_temporary_files_and_the_outside_are_not_reported() {
        let root = Path::new("/vault");
        for path in [
            "/vault",
            "/vault/.git/index",
            "/vault/x/node_modules/y.md",
            "/vault/Inbox/a.md.dfai-lite-tmp",
            "/elsewhere/a.md",
        ] {
            assert_eq!(relative(root, Path::new(path)), None, "{path}");
        }
    }
}
