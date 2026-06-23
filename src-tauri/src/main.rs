#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const BLOCKED_DOMAINS: &[&str] = &[
    "google-analytics.com",
    "googletagmanager.com",
    "googletagservices.com",
    "googlesyndication.com",
    "doubleclick.net",
    "connect.facebook.net",
    "analytics.twitter.com",
    "scorecardresearch.com",
    "quantserve.com",
    "mixpanel.com",
    "segment.com",
    "segment.io",
    "hotjar.com",
    "fullstory.com",
    "intercom.io",
    "mouseflow.com",
    "crazyegg.com",
    "optimizely.com",
    "adroll.com",
    "criteo.com",
    "criteo.net",
    "amazon-adsystem.com",
    "ads.linkedin.com",
    "mc.yandex.ru",
    "ads.yahoo.com",
];

fn is_tracker(url: &str) -> bool {
    let lower = url.to_lowercase();
    BLOCKED_DOMAINS.iter().any(|domain| lower.contains(domain))
}

#[derive(Default)]
struct TabState {
    tabs: HashMap<u32, String>,
}

type SharedState = Arc<Mutex<TabState>>;

#[tauri::command]
async fn navigate(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    tab_id: u32,
    url: String,
) -> Result<(), String> {
    let label = format!("tab-{}", tab_id);

    let safe_url = if url.starts_with("http://") {
        url.replacen("http://", "https://", 1)
    } else {
        url.clone()
    };

    let parsed = WebviewUrl::External(
        safe_url.parse().map_err(|e| format!("Invalid URL: {e}"))?,
    );

    {
        let mut s = state.lock().unwrap();

        if s.tabs.contains_key(&tab_id) {
            if let Some(webview) = app.get_webview_window(&label) {
                webview
                    .navigate(safe_url.parse().map_err(|e| format!("{e}"))?)
                    .map_err(|e| e.to_string())?;
            }
        } else {
            let main_window = app
                .get_webview_window("main")
                .ok_or("Main window not found")?;

            let main_pos = main_window.outer_position().map_err(|e| e.to_string())?;
            let main_size = main_window.inner_size().map_err(|e| e.to_string())?;

            let _webview = WebviewWindowBuilder::new(&app, &label, parsed)
                .parent(&main_window)
                .map_err(|e| e.to_string())?
                .inner_size(main_size.width as f64, main_size.height.saturating_sub(84) as f64)
                .position(main_pos.x as f64, (main_pos.y + 84) as f64)
                .decorations(false)
                .build()
                .map_err(|e| e.to_string())?;

            s.tabs.insert(tab_id, label.clone());
        }
    }

    app.emit(
        "nav-committed",
        serde_json::json!({ "tabId": tab_id, "url": safe_url, "title": "" }),
    )
    .ok();

    Ok(())
}

#[tauri::command]
async fn show_tab(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    tab_id: u32,
) -> Result<(), String> {
    let s = state.lock().unwrap();
    for (id, label) in &s.tabs {
        if let Some(wv) = app.get_webview_window(label) {
            if *id == tab_id {
                wv.show().ok();
            } else {
                wv.hide().ok();
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn hide_all_tabs(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    let s = state.lock().unwrap();
    for label in s.tabs.values() {
        if let Some(wv) = app.get_webview_window(label) {
            wv.hide().ok();
        }
    }
    Ok(())
}

#[tauri::command]
async fn go_back(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    tab_id: u32,
) -> Result<(), String> {
    let s = state.lock().unwrap();
    if let Some(label) = s.tabs.get(&tab_id) {
        if let Some(wv) = app.get_webview_window(label) {
            wv.eval("history.back()").ok();
        }
    }
    Ok(())
}

#[tauri::command]
async fn go_forward(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    tab_id: u32,
) -> Result<(), String> {
    let s = state.lock().unwrap();
    if let Some(label) = s.tabs.get(&tab_id) {
        if let Some(wv) = app.get_webview_window(label) {
            wv.eval("history.forward()").ok();
        }
    }
    Ok(())
}

#[tauri::command]
async fn go_refresh(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    tab_id: u32,
) -> Result<(), String> {
    let s = state.lock().unwrap();
    if let Some(label) = s.tabs.get(&tab_id) {
        if let Some(wv) = app.get_webview_window(label) {
            wv.eval("location.reload()").ok();
        }
    }
    Ok(())
}

fn main() {
    let state: SharedState = Arc::new(Mutex::new(TabState::default()));

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            navigate,
            show_tab,
            hide_all_tabs,
            go_back,
            go_forward,
            go_refresh,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let main_window = app.get_webview_window("main").unwrap();

            main_window.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::Moved(position) => {
                        let state = app_handle.state::<SharedState>();
                        let s = state.lock().unwrap();
                        for label in s.tabs.values() {
                            if let Some(wv) = app_handle.get_webview_window(label) {
                                let _ = wv.set_position(tauri::PhysicalPosition {
                                    x: position.x,
                                    y: position.y + 84,
                                });
                            }
                        }
                    }
                    tauri::WindowEvent::Resized(size) => {
                        let state = app_handle.state::<SharedState>();
                        let s = state.lock().unwrap();
                        for label in s.tabs.values() {
                            if let Some(wv) = app_handle.get_webview_window(label) {
                                let content_height = size.height.saturating_sub(84);
                                let _ = wv.set_size(tauri::PhysicalSize {
                                    width: size.width,
                                    height: content_height,
                                });
                            }
                        }
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Whiskers");
}