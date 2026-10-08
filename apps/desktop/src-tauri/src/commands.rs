use crate::app_state::AppState;
use crate::document_files::{
    atomic_write, blank_hwp_bytes, editable_core_from_bytes, ensure_document_path,
    ensure_target_parent, file_fingerprint, written_fingerprint, FileFingerprint,
};
use crate::font_catalog::LocalFontEntry;
use crate::recent_documents::{self, RecentDocument};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use uuid::Uuid;

const PATH_HEADER: &str = "x-hop-path";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRange {
    pub start: Option<u32>,
    pub end: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub job_id: String,
    pub phase: String,
    pub done: u32,
    pub total: u32,
    pub message: String,
}

// File I/O commands are async so they run off the main thread.

#[tauri::command]
pub async fn read_document(path: String) -> Result<Response, String> {
    let path = PathBuf::from(path);
    ensure_document_path(&path)?;
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("문서를 읽을 수 없습니다: {} ({})", path.display(), e))
}

/// Body: document bytes. Header `x-hop-path`: percent-encoded target path.
#[tauri::command]
pub async fn write_document(request: Request<'_>) -> Result<FileFingerprint, String> {
    let (path, bytes) = raw_body_with_path(&request)?;
    ensure_document_path(&path)?;
    atomic_write(&path, bytes)?;
    written_fingerprint(&path, bytes)
        .map_err(|e| format!("저장한 파일 정보를 읽을 수 없습니다: {} ({})", path.display(), e))
}

#[tauri::command]
pub async fn file_fingerprint_of(path: String) -> Option<FileFingerprint> {
    file_fingerprint(Path::new(&path)).ok()
}

#[tauri::command]
pub async fn new_document_bytes() -> Result<Response, String> {
    blank_hwp_bytes().map(Response::new)
}

/// Body: HWP bytes exported by studio. Header `x-hop-path`: target PDF path.
#[tauri::command]
pub async fn export_pdf_bytes(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let (path, bytes) = raw_body_with_path(&request)?;
    ensure_target_parent(&path)?;
    crate::pdf_export::ensure_pdf_path(&path)?;
    let core = editable_core_from_bytes(bytes)?;
    let job_id = Uuid::new_v4().to_string();
    let font_dirs = crate::font_catalog::pdf_font_dirs(&app);
    let total = crate::pdf_export::export_core_to_pdf(
        &core,
        &path,
        None::<PageRange>,
        font_dirs,
        |phase, done, total, message| emit_progress(&app, &job_id, phase, done, total, &message),
    )?;
    emit_progress(&app, &job_id, "done", total, total, "PDF 내보내기가 완료되었습니다");
    Ok(())
}

fn raw_body_with_path<'a>(request: &'a Request<'_>) -> Result<(PathBuf, &'a [u8]), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("문서 바이트가 필요합니다.".to_string());
    };
    let encoded = request
        .headers()
        .get(PATH_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| format!("{PATH_HEADER} 헤더가 필요합니다."))?;
    let path = percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|e| format!("경로를 해석할 수 없습니다: {}", e))?;
    Ok((PathBuf::from(path.as_ref()), bytes.as_slice()))
}

#[tauri::command]
pub fn take_pending_open_paths(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    state.pending_open_paths.take_for_window(window.label())
}

#[tauri::command]
pub async fn open_documents_in_new_windows(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::open_paths_in_new_windows(&app, paths))
        .await
        .map_err(|e| format!("새 창 생성 작업 실패: {}", e))
}

#[tauri::command]
pub fn list_recent_documents(app: AppHandle) -> Result<Vec<RecentDocument>, String> {
    recent_documents::list_documents(&app)
}

#[tauri::command]
pub fn clear_recent_documents(app: AppHandle) -> Result<(), String> {
    recent_documents::clear_documents(&app)
}

#[tauri::command]
pub fn record_recent_document(app: AppHandle, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    recent_documents::record_document(&app, &path)?;
    note_platform_recent_document(&app, &path)
}

#[cfg(target_os = "macos")]
fn note_platform_recent_document(app: &AppHandle, path: &Path) -> Result<(), String> {
    crate::macos_recent_documents::note_recent_document(app, path)
}

#[cfg(not(target_os = "macos"))]
fn note_platform_recent_document(_app: &AppHandle, _path: &Path) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn print_webview(window: WebviewWindow) -> Result<(), String> {
    window
        .print()
        .map_err(|e| format!("인쇄 대화상자를 열 수 없습니다: {}", e))
}

#[tauri::command]
pub fn destroy_current_window(window: WebviewWindow) -> Result<(), String> {
    window
        .destroy()
        .map_err(|e| format!("창을 닫을 수 없습니다: {}", e))
}

#[tauri::command]
pub fn cancel_app_quit(app: AppHandle) -> Result<(), String> {
    crate::app_quit::cancel_app_quit_request(&app)
}

#[tauri::command]
pub async fn list_local_fonts() -> Result<Vec<LocalFontEntry>, String> {
    Ok(crate::font_catalog::collect_desktop_local_font_entries())
}

#[tauri::command]
pub async fn read_local_font(path: String) -> Result<Response, String> {
    crate::font_catalog::read_desktop_local_font(Path::new(&path)).map(Response::new)
}

#[tauri::command]
pub async fn create_editor_window(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::windows::create_editor_window(&app))
        .await
        .map_err(|e| format!("새 창 생성 작업 실패: {}", e))?
}

fn emit_progress(app: &AppHandle, job_id: &str, phase: &str, done: u32, total: u32, message: &str) {
    let _ = app.emit(
        "hop-job-progress",
        JobProgress {
            job_id: job_id.to_string(),
            phase: phase.to_string(),
            done,
            total,
            message: message.to_string(),
        },
    );
}
