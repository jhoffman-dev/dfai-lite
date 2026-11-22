//! The DFAI Lite host. As little as possible (CLAUDE.md): it reads and writes
//! files inside the chosen vault, watches it, and runs fixed-shape `git`
//! commands there. It decides nothing; the rules are in TypeScript.

mod files;
mod git;
mod menu;
mod paths;
mod settings;
mod text_input;
mod vault;
mod watcher;

use std::sync::{Mutex, MutexGuard};

pub fn run() {
    // Before any web view exists: WebKit reads these once, on first use.
    text_input::turn_off_substitutions();
    tauri::Builder::default()
        .menu(menu::build)
        .on_menu_event(menu::on_event)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(vault::VaultRoot::default())
        .manage(watcher::VaultWatcher::default())
        .invoke_handler(tauri::generate_handler![
            vault::open_vault,
            vault::read_vault,
            vault::read_file,
            vault::write_file,
            vault::rename_file,
            vault::delete_file,
            vault::create_folder,
            vault::remove_folder,
            vault::rename_folder,
            vault::read_ignore_file,
            vault::write_ignore_file,
            vault::find_unsyncable,
            git::git_run,
            git::mac_name,
            settings::read_settings,
            settings::write_settings,
        ])
        .run(tauri::generate_context!())
        .expect("DFAI Lite could not start");
}

/// The lock's value, even after a thread panicked holding it: what it guards
/// (a path, a watcher) is never left half-written.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod test_support {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    /// A new empty folder under the system temp folder, canonical (`/private/var` on a Mac).
    pub fn temp_folder() -> PathBuf {
        let at = NEXT.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!("dfai-lite-test-{}-{at}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path.canonicalize().unwrap()
    }
}
