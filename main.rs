#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let main_window = app.get_webview_window("main").unwrap();
            main_window.set_title("Whiskers").ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Whiskers");
}
