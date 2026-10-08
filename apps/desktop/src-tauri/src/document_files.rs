//! Document bytes on disk: path checks, atomic writes, change fingerprints and blank documents.
use hop_rhwp_adapter::DocumentCore;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;
use tempfile::NamedTempFile;

/// Detects edits made outside HOP between opening and saving a document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileFingerprint {
    len: u64,
    modified_millis: u64,
    content_hash: u32,
}

pub fn ensure_document_path(path: &Path) -> Result<(), String> {
    match crate::document_path_from_path(path) {
        Some(_) => Ok(()),
        None => Err(format!("HWP/HWPX 문서만 열고 저장할 수 있습니다: {}", path.display())),
    }
}

pub fn ensure_target_parent(path: &Path) -> Result<(), String> {
    match path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        Some(parent) if parent.is_dir() => Ok(()),
        _ => Err(format!("저장할 폴더를 찾을 수 없습니다: {}", path.display())),
    }
}

/// Writes through a sibling temp file so a failed save never truncates the target.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    ensure_target_parent(path)?;
    let parent = path.parent().expect("checked by ensure_target_parent");
    let mut tmp = NamedTempFile::new_in(parent)
        .map_err(|e| format!("임시 파일 생성 실패: {} ({})", parent.display(), e))?;
    tmp.write_all(bytes)
        .map_err(|e| format!("임시 파일 쓰기 실패: {}", e))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| format!("임시 파일 flush 실패: {}", e))?;
    tmp.persist(path)
        .map_err(|e| format!("파일 교체 실패: {} ({})", path.display(), e.error))?;
    Ok(())
}

pub fn file_fingerprint(path: &Path) -> std::io::Result<FileFingerprint> {
    let metadata = std::fs::metadata(path)?;
    let mut file = std::fs::File::open(path)?;
    fingerprint_from_metadata(metadata, hash_reader(&mut file)?)
}

/// Fingerprint of a file just written from `bytes`, without reading it back.
pub fn written_fingerprint(path: &Path, bytes: &[u8]) -> std::io::Result<FileFingerprint> {
    fingerprint_from_metadata(std::fs::metadata(path)?, hash_bytes(bytes))
}

fn fingerprint_from_metadata(
    metadata: std::fs::Metadata,
    content_hash: u32,
) -> std::io::Result<FileFingerprint> {
    let modified_millis = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Ok(FileFingerprint {
        len: metadata.len(),
        modified_millis,
        content_hash,
    })
}

const FNV1A32_OFFSET_BASIS: u32 = 0x811C9DC5;
const FNV1A32_PRIME: u32 = 0x01000193;

fn hash_reader(reader: &mut impl Read) -> std::io::Result<u32> {
    let mut hash = FNV1A32_OFFSET_BASIS;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(hash);
        }
        hash = fnv1a32_update(hash, &buffer[..read]);
    }
}

fn hash_bytes(bytes: &[u8]) -> u32 {
    fnv1a32_update(FNV1A32_OFFSET_BASIS, bytes)
}

fn fnv1a32_update(mut hash: u32, bytes: &[u8]) -> u32 {
    for byte in bytes {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(FNV1A32_PRIME);
    }
    hash
}

pub fn editable_core_from_bytes(bytes: &[u8]) -> Result<DocumentCore, String> {
    let mut core = DocumentCore::from_bytes(bytes).map_err(|e| format!("문서 파싱 실패: {}", e))?;
    core.convert_to_editable_native()
        .map_err(|e| format!("문서 변환 실패: {}", e))?;
    Ok(core)
}

pub fn blank_hwp_bytes() -> Result<Vec<u8>, String> {
    let mut core = DocumentCore::new_empty();
    core.create_blank_document_native()
        .map_err(|e| format!("빈 문서 생성 실패: {}", e))?;
    core.export_hwp_native()
        .map_err(|e| format!("빈 문서 직렬화 실패: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.hwp");
        atomic_write(&path, b"old").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
    }

    #[test]
    fn atomic_write_rejects_missing_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(atomic_write(&dir.path().join("missing/doc.hwp"), b"x").is_err());
    }

    #[test]
    fn written_and_read_fingerprints_match_and_detect_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.hwp");
        let bytes = vec![7_u8; 200 * 1024];
        atomic_write(&path, &bytes).unwrap();
        let written = written_fingerprint(&path, &bytes).unwrap();
        assert_eq!(written, file_fingerprint(&path).unwrap());

        std::fs::write(&path, b"changed elsewhere").unwrap();
        assert_ne!(written, file_fingerprint(&path).unwrap());
    }

    #[test]
    fn ensure_document_path_accepts_only_hwp_and_hwpx() {
        assert!(ensure_document_path(Path::new("/tmp/a.hwp")).is_ok());
        assert!(ensure_document_path(Path::new("/tmp/a.HWPX")).is_ok());
        assert!(ensure_document_path(Path::new("/tmp/a.pdf")).is_err());
    }

    #[test]
    fn blank_document_bytes_parse_as_a_document() {
        let bytes = blank_hwp_bytes().unwrap();
        let core = editable_core_from_bytes(&bytes).unwrap();
        assert!(core.page_count() >= 1);
    }
}
