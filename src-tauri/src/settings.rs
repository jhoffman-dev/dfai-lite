//! This Mac's settings for the app (the vault folder, the hotkey, how the
//! window looks), as one JSON text in the app's config folder. The text is
//! TypeScript's: read and written whole, never parsed here.

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const FILE: &str = "settings.json";

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("no config folder: {error}"))?;
    Ok(folder.join(FILE))
}

#[tauri::command]
pub fn read_settings(app: AppHandle) -> Result<Option<String>, String> {
    match fs::read_to_string(settings_file(&app)?) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("cannot read the settings: {error}")),
    }
}

/// Written beside, then renamed over, so a crash never leaves half a file.
#[tauri::command]
pub fn write_settings(app: AppHandle, text: String) -> Result<(), String> {
    let file = settings_file(&app)?;
    if let Some(folder) = file.parent() {
        fs::create_dir_all(folder).map_err(|error| format!("cannot save the settings: {error}"))?;
    }
    let temp = file.with_extension("json.tmp");
    fs::write(&temp, text).map_err(|error| format!("cannot save the settings: {error}"))?;
    fs::rename(&temp, &file).map_err(|error| format!("cannot save the settings: {error}"))
}
