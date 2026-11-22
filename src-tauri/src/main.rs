// No console window on Windows in release builds; the app ships for the Mac only.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dfai_lite_lib::run()
}
