//! The Mac menu bar, built by hand: Tauri's default binds ⌘W to "Close
//! Window", which macOS fires before the page sees the key. The page owns
//! ⌘W (close a tab), ⌘N, ⌘T, ⌘K, ⌘E, ⌘\, ⌘1–9 and ⌘/, so no menu item takes
//! them; closing the window is ⇧⌘W.

use tauri::menu::{
    IsMenuItem, Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Manager, Runtime};

/// The one item of the app's own: what macOS calls ⌘W elsewhere, moved to ⇧⌘W.
const CLOSE_WINDOW: &str = "close-window";
const CLOSE_WINDOW_KEY: &str = "Shift+CmdOrCtrl+W";

/// What a submenu holds, as a plan the tests can read without a running app.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Entry {
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Fullscreen,
    Minimize,
    Zoom,
    /// The custom close item, on [`CLOSE_WINDOW_KEY`].
    CloseWindow,
    Separator,
}

/// The menu bar: App, Edit, View, Window.
const PLAN: &[(&str, &[Entry])] = &[
    (
        "DFAI Lite",
        &[
            Entry::About,
            Entry::Separator,
            Entry::Services,
            Entry::Separator,
            Entry::Hide,
            Entry::HideOthers,
            Entry::ShowAll,
            Entry::Separator,
            Entry::Quit,
        ],
    ),
    (
        "Edit",
        &[
            Entry::Undo,
            Entry::Redo,
            Entry::Separator,
            Entry::Cut,
            Entry::Copy,
            Entry::Paste,
            Entry::SelectAll,
        ],
    ),
    ("View", &[Entry::Fullscreen]),
    (
        "Window",
        &[
            Entry::Minimize,
            Entry::Zoom,
            Entry::Separator,
            Entry::CloseWindow,
        ],
    ),
];

/// The keys macOS gives each predefined item, and the custom item's own:
/// what the tests hold the plan to.
#[cfg(test)]
fn key_of(entry: Entry) -> Option<&'static str> {
    match entry {
        Entry::Hide => Some("Cmd+H"),
        Entry::HideOthers => Some("Alt+Cmd+H"),
        Entry::Quit => Some("Cmd+Q"),
        Entry::Undo => Some("Cmd+Z"),
        Entry::Redo => Some("Shift+Cmd+Z"),
        Entry::Cut => Some("Cmd+X"),
        Entry::Copy => Some("Cmd+C"),
        Entry::Paste => Some("Cmd+V"),
        Entry::SelectAll => Some("Cmd+A"),
        Entry::Fullscreen => Some("Ctrl+Cmd+F"),
        Entry::Minimize => Some("Cmd+M"),
        Entry::CloseWindow => Some("Shift+Cmd+W"),
        _ => None,
    }
}

fn item<R: Runtime>(app: &AppHandle<R>, entry: Entry) -> tauri::Result<MenuItemKind<R>> {
    let predefined = match entry {
        Entry::About => PredefinedMenuItem::about(app, None, None),
        Entry::Services => PredefinedMenuItem::services(app, None),
        Entry::Hide => PredefinedMenuItem::hide(app, None),
        Entry::HideOthers => PredefinedMenuItem::hide_others(app, None),
        Entry::ShowAll => PredefinedMenuItem::show_all(app, None),
        Entry::Quit => PredefinedMenuItem::quit(app, None),
        Entry::Undo => PredefinedMenuItem::undo(app, None),
        Entry::Redo => PredefinedMenuItem::redo(app, None),
        Entry::Cut => PredefinedMenuItem::cut(app, None),
        Entry::Copy => PredefinedMenuItem::copy(app, None),
        Entry::Paste => PredefinedMenuItem::paste(app, None),
        Entry::SelectAll => PredefinedMenuItem::select_all(app, None),
        Entry::Fullscreen => PredefinedMenuItem::fullscreen(app, None),
        Entry::Minimize => PredefinedMenuItem::minimize(app, None),
        Entry::Zoom => PredefinedMenuItem::maximize(app, Some("Zoom")),
        Entry::Separator => PredefinedMenuItem::separator(app),
        Entry::CloseWindow => {
            let close = MenuItem::with_id(
                app,
                CLOSE_WINDOW,
                "Close Window",
                true,
                Some(CLOSE_WINDOW_KEY),
            )?;
            return Ok(close.kind());
        }
    }?;
    Ok(predefined.kind())
}

/// The menu bar, from [`PLAN`].
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    for (title, entries) in PLAN {
        let items = entries
            .iter()
            .map(|entry| item(app, *entry))
            .collect::<tauri::Result<Vec<_>>>()?;
        let refs: Vec<&dyn IsMenuItem<R>> = items
            .iter()
            .map(|item| item as &dyn IsMenuItem<R>)
            .collect();
        menu.append(&Submenu::with_items(app, *title, true, &refs)?)?;
    }
    Ok(menu)
}

/// The custom close item closes the window it was chosen in front of.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() != CLOSE_WINDOW {
        return;
    }
    let focused = app
        .webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false));
    if let Some(window) = focused {
        // A window already closing has nothing left to close.
        let _ = window.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The keys the page owns: the menu must leave every one of them alone.
    const PAGE_KEYS: &[&str] = &[
        "Cmd+W", "Cmd+N", "Cmd+T", "Cmd+K", "Cmd+E", "Cmd+\\", "Cmd+/", "Cmd+1", "Cmd+2", "Cmd+3",
        "Cmd+4", "Cmd+5", "Cmd+6", "Cmd+7", "Cmd+8", "Cmd+9",
    ];

    fn entries() -> impl Iterator<Item = Entry> {
        PLAN.iter().flat_map(|(_, entries)| entries.iter().copied())
    }

    #[test]
    fn no_menu_item_takes_a_key_the_page_owns() {
        for entry in entries() {
            if let Some(key) = key_of(entry) {
                assert!(!PAGE_KEYS.contains(&key), "{entry:?} takes {key}");
            }
        }
    }

    #[test]
    fn closing_the_window_is_the_custom_item_on_shift_command_w() {
        assert_eq!(
            entries()
                .filter(|entry| *entry == Entry::CloseWindow)
                .count(),
            1
        );
        assert_eq!(key_of(Entry::CloseWindow), Some("Shift+Cmd+W"));
        assert_eq!(CLOSE_WINDOW_KEY, "Shift+CmdOrCtrl+W");
    }

    #[test]
    fn editing_keys_stay_in_the_menu_so_the_editor_keeps_them() {
        let all: Vec<Entry> = entries().collect();
        for wanted in [
            Entry::Undo,
            Entry::Redo,
            Entry::Cut,
            Entry::Copy,
            Entry::Paste,
            Entry::SelectAll,
            Entry::Quit,
            Entry::Minimize,
            Entry::Fullscreen,
        ] {
            assert!(all.contains(&wanted), "{wanted:?} is missing");
        }
    }
}
