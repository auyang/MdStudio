use crate::services::documents::{self, DocumentType};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::UNIX_EPOCH,
};
use thiserror::Error;

pub const MAX_PDF_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_PDF_RANGE_BYTES: u64 = 1024 * 1024;
const PDF_READ_CHUNK_BYTES: usize = 64 * 1024;
const MAX_EARLY_CANCELLATIONS: usize = 256;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDocumentInfo {
    pub canonical_path: String,
    pub display_name: String,
    pub byte_size: u64,
    pub modified_unix_micros: u64,
}

#[derive(Debug, Error)]
pub enum PdfReaderError {
    #[error("PDF 文件路径无效或文件不存在")]
    InvalidPath,
    #[error("PDF 文件超过 256 MiB 的读取上限")]
    TooLarge,
    #[error("文件签名无效，不是有效的 PDF 文件")]
    InvalidPdf,
    #[error("PDF 文件在读取期间已发生变化，请重新打开")]
    Changed,
    #[error("PDF 数据范围无效")]
    InvalidRange,
    #[error("PDF 读取已取消")]
    Cancelled,
    #[error("读取 PDF 文件失败：{0}")]
    Io(#[from] io::Error),
    #[error("PDF 读取请求 ID 无效")]
    InvalidRequestId,
    #[error("PDF 读取请求 ID 已在使用")]
    DuplicateRequestId,
    #[error("PDF 读取状态不可用")]
    RegistryUnavailable,
}

pub fn inspect_pdf_document(file_path: &str) -> Result<PdfDocumentInfo, PdfReaderError> {
    let descriptor =
        documents::inspect_document_path(file_path).map_err(|_| PdfReaderError::InvalidPath)?;
    if descriptor.document_type != DocumentType::Pdf || !descriptor.exists {
        return Err(PdfReaderError::InvalidPath);
    }
    let canonical_path = Path::new(&descriptor.canonical_path);
    let metadata = fs::metadata(canonical_path)?;
    if !metadata.is_file() {
        return Err(PdfReaderError::InvalidPath);
    }
    let byte_size = metadata.len();
    if byte_size > MAX_PDF_BYTES {
        return Err(PdfReaderError::TooLarge);
    }
    let modified_unix_micros = modified_unix_micros(&metadata)?;
    let mut file = File::open(canonical_path)?;
    let mut header = [0u8; 1024];
    let header_len = file.read(&mut header)?;
    if !header[..header_len]
        .windows(5)
        .any(|window| window == b"%PDF-")
    {
        return Err(PdfReaderError::InvalidPdf);
    }
    Ok(PdfDocumentInfo {
        canonical_path: descriptor.canonical_path,
        display_name: descriptor.display_name,
        byte_size,
        modified_unix_micros,
    })
}

fn modified_unix_micros(metadata: &fs::Metadata) -> Result<u64, PdfReaderError> {
    Ok(metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros()
        .min(u64::MAX as u128) as u64)
}

pub fn read_pdf_range(
    file_path: &str,
    expected_byte_size: u64,
    expected_modified_unix_micros: u64,
    begin: u64,
    end: u64,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, PdfReaderError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(PdfReaderError::Cancelled);
    }
    let info = inspect_pdf_document(file_path)?;
    if info.byte_size != expected_byte_size
        || info.modified_unix_micros != expected_modified_unix_micros
    {
        return Err(PdfReaderError::Changed);
    }
    if begin >= end || end > info.byte_size || end - begin > MAX_PDF_RANGE_BYTES {
        return Err(PdfReaderError::InvalidRange);
    }
    let length = usize::try_from(end - begin).map_err(|_| PdfReaderError::InvalidRange)?;
    let mut file = File::open(&info.canonical_path)?;
    file.seek(SeekFrom::Start(begin))?;
    let mut result = Vec::with_capacity(length);
    let mut remaining = length;
    let mut buffer = vec![0u8; PDF_READ_CHUNK_BYTES.min(length)];
    while remaining > 0 {
        if cancelled.load(Ordering::Acquire) {
            return Err(PdfReaderError::Cancelled);
        }
        let target = remaining.min(buffer.len());
        let read = file.read(&mut buffer[..target])?;
        if read == 0 {
            return Err(PdfReaderError::Changed);
        }
        result.extend_from_slice(&buffer[..read]);
        remaining -= read;
    }
    if cancelled.load(Ordering::Acquire) {
        return Err(PdfReaderError::Cancelled);
    }
    Ok(result)
}

#[derive(Default, Clone)]
pub struct PdfReadRegistry(Arc<Mutex<PdfReadRegistryState>>);

#[derive(Default)]
struct PdfReadRegistryState {
    active: HashMap<String, Arc<AtomicBool>>,
    early_cancelled: HashSet<String>,
    early_order: VecDeque<String>,
}

impl PdfReadRegistry {
    pub fn start(&self, request_id: String) -> Result<Arc<AtomicBool>, PdfReaderError> {
        if request_id.is_empty() || request_id.len() > 128 {
            return Err(PdfReaderError::InvalidRequestId);
        }
        let mut state = self
            .0
            .lock()
            .map_err(|_| PdfReaderError::RegistryUnavailable)?;
        if state.active.contains_key(&request_id) {
            return Err(PdfReaderError::DuplicateRequestId);
        }
        let cancelled = Arc::new(AtomicBool::new(state.early_cancelled.remove(&request_id)));
        state.early_order.retain(|id| id != &request_id);
        state.active.insert(request_id, Arc::clone(&cancelled));
        Ok(cancelled)
    }

    pub fn cancel(&self, request_id: &str) -> Result<(), PdfReaderError> {
        if request_id.is_empty() || request_id.len() > 128 {
            return Err(PdfReaderError::InvalidRequestId);
        }
        let mut state = self
            .0
            .lock()
            .map_err(|_| PdfReaderError::RegistryUnavailable)?;
        if let Some(cancelled) = state.active.get(request_id) {
            cancelled.store(true, Ordering::Release);
        } else if state.early_cancelled.insert(request_id.to_string()) {
            state.early_order.push_back(request_id.to_string());
            while state.early_order.len() > MAX_EARLY_CANCELLATIONS {
                if let Some(expired) = state.early_order.pop_front() {
                    state.early_cancelled.remove(&expired);
                }
            }
        }
        Ok(())
    }

    pub fn finish(&self, request_id: &str) -> Result<(), PdfReaderError> {
        self.0
            .lock()
            .map_err(|_| PdfReaderError::RegistryUnavailable)?
            .active
            .remove(request_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::OpenOptions,
        sync::atomic::AtomicBool,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_pdf(label: &str, bytes: &[u8]) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("mdstudio-pdf-{label}-{unique}.pdf"));
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn inspects_pdf_metadata_and_reads_bounded_binary_ranges() {
        let bytes = b"%PDF-1.7\n0123456789abcdefghijklmnopqrstuvwxyz";
        let path = temp_pdf("range", bytes);
        let info = inspect_pdf_document(path.to_str().unwrap()).unwrap();
        assert_eq!(info.byte_size, bytes.len() as u64);
        let result = read_pdf_range(
            &info.canonical_path,
            info.byte_size,
            info.modified_unix_micros,
            9,
            19,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(result, b"0123456789");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_non_pdf_signatures_and_oversized_files() {
        let invalid = temp_pdf("invalid", b"not a pdf");
        assert!(matches!(
            inspect_pdf_document(invalid.to_str().unwrap()),
            Err(PdfReaderError::InvalidPdf)
        ));
        fs::remove_file(invalid).unwrap();

        let oversized = temp_pdf("oversized", b"%PDF-1.7");
        OpenOptions::new()
            .write(true)
            .open(&oversized)
            .unwrap()
            .set_len(MAX_PDF_BYTES + 1)
            .unwrap();
        assert!(matches!(
            inspect_pdf_document(oversized.to_str().unwrap()),
            Err(PdfReaderError::TooLarge)
        ));
        fs::remove_file(oversized).unwrap();
    }

    #[test]
    fn rejects_invalid_ranges_changed_files_and_cancelled_reads() {
        let path = temp_pdf("bounds", b"%PDF-1.7\ncontents");
        let info = inspect_pdf_document(path.to_str().unwrap()).unwrap();
        assert!(matches!(
            read_pdf_range(
                &info.canonical_path,
                info.byte_size,
                info.modified_unix_micros,
                0,
                info.byte_size + 1,
                &AtomicBool::new(false),
            ),
            Err(PdfReaderError::InvalidRange)
        ));
        fs::write(&path, b"%PDF-1.7\nchanged contents").unwrap();
        assert!(matches!(
            read_pdf_range(
                info.canonical_path.as_str(),
                info.byte_size,
                info.modified_unix_micros,
                0,
                8,
                &AtomicBool::new(false),
            ),
            Err(PdfReaderError::Changed)
        ));
        assert!(matches!(
            read_pdf_range(path.to_str().unwrap(), 20, 0, 0, 8, &AtomicBool::new(true),),
            Err(PdfReaderError::Cancelled)
        ));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn read_registry_cancels_active_and_early_requests() {
        let registry = PdfReadRegistry::default();
        registry.cancel("early-1").unwrap();
        assert!(registry
            .start("early-1".into())
            .unwrap()
            .load(Ordering::Acquire));
        let active = registry.start("active-1".into()).unwrap();
        registry.cancel("active-1").unwrap();
        assert!(active.load(Ordering::Acquire));
        registry.finish("active-1").unwrap();
        assert!(registry.start("".into()).is_err());
    }
}
