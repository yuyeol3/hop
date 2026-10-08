// Spike: thin native shell around unmodified rhwp-studio.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

const HOST_SCRIPT: &str = include_str!("../../host/hop-host.js");
const DOCUMENT_EXTENSIONS: &[&str] = &["hwp", "hwpx"];

#[tauri::command]
fn read_document(path: String) -> Result<Response, String> {
    fs::read(&path).map(Response::new).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_document(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw document bytes".into());
    };
    let encoded = request
        .headers()
        .get("x-hop-path")
        .and_then(|value| value.to_str().ok())
        .ok_or("missing x-hop-path header")?;
    let path = PathBuf::from(percent_decode_str(encoded).decode_utf8().map_err(|e| e.to_string())?.as_ref());
    write_atomically(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

/// Write to a sibling temp file, then replace the target so a failed save never truncates it.
fn write_atomically(path: &PathBuf, bytes: &[u8]) -> std::io::Result<()> {
    let mut temp_name = path.file_name().unwrap_or_default().to_os_string();
    temp_name.push(".hop-saving");
    let temp = path.with_file_name(temp_name);
    {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&temp, path).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}

// Async so the blocking native dialog runs off the main thread.
#[tauri::command]
async fn pick_open_path(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("한글 문서", DOCUMENT_EXTENSIONS)
        .blocking_pick_file()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn pick_save_path(app: AppHandle, suggested: String) -> Option<String> {
    app.dialog()
        .file()
        .set_file_name(suggested)
        .add_filter("한글 문서", DOCUMENT_EXTENSIONS)
        .blocking_save_file()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn startup_path() -> Option<String> {
    std::env::args().skip(1).find(|arg| !arg.starts_with('-'))
}

#[tauri::command]
fn smoke_config() -> Option<serde_json::Value> {
    let input = std::env::var("HOP_SMOKE_INPUT").ok()?;
    let output = std::env::var("HOP_SMOKE_OUTPUT").ok()?;
    Some(serde_json::json!({ "input": input, "output": output }))
}

#[tauri::command]
fn host_log(message: String) {
    eprintln!("[hop-host] {message}");
    if let Ok(path) = std::env::var("HOP_SMOKE_LOG") {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{message}");
        }
    }
}

#[tauri::command]
fn smoke_exit(app: AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            pick_open_path,
            pick_save_path,
            startup_path,
            smoke_config,
            host_log,
            smoke_exit,
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("HOP (thin shell spike)")
                .inner_size(1280.0, 860.0)
                .initialization_script(HOST_SCRIPT)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run HOP thin shell");
}
