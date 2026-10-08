//! Debug-build smoke test hooks. CI runs the real app with HOP_SMOKE_INPUT/OUTPUT/LOG set; the host
//! opens the input, saves it as the output, reopens it, logs the result and asks to exit.
use std::io::Write;
use tauri::AppHandle;

#[tauri::command]
pub fn smoke_config() -> Option<serde_json::Value> {
    let input = std::env::var("HOP_SMOKE_INPUT").ok()?;
    let output = std::env::var("HOP_SMOKE_OUTPUT").ok()?;
    Some(serde_json::json!({ "input": input, "output": output }))
}

#[tauri::command]
pub fn smoke_log(message: String) {
    eprintln!("[smoke] {message}");
    let Ok(path) = std::env::var("HOP_SMOKE_LOG") else {
        return;
    };
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

#[tauri::command]
pub fn smoke_exit(app: AppHandle) {
    app.exit(0);
}
