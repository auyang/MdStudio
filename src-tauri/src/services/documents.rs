use serde::Serialize;
use std::{fs, io, path::Path};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentType {
    Markdown,
    Pdf,
    Ofd,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDescriptor {
    pub document_type: DocumentType,
    pub canonical_path: String,
    pub display_name: String,
    pub exists: bool,
    pub byte_size: Option<u64>,
}

#[derive(Debug, Error)]
pub enum DocumentPathError {
    #[error("不支持的文档格式或无效路径：{0}")]
    InvalidPath(String),
    #[error("无法检查文档路径：{0}")]
    Io(#[from] io::Error),
}

pub fn document_type(path: &Path) -> Option<DocumentType> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "md" | "markdown" => Some(DocumentType::Markdown),
        "pdf" => Some(DocumentType::Pdf),
        "ofd" => Some(DocumentType::Ofd),
        _ => None,
    }
}

/// 仅检查文档身份与本地路径，不读取或解析 PDF/OFD 内容。
/// 对不存在的 Markdown 文件保留规范路径，供阅读器显示可重试的 missing 标签。
pub fn inspect_document_path(file_path: &str) -> Result<DocumentDescriptor, DocumentPathError> {
    let requested = Path::new(file_path);
    let kind = document_type(requested)
        .ok_or_else(|| DocumentPathError::InvalidPath(file_path.to_string()))?;
    let display_name = requested
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| DocumentPathError::InvalidPath(file_path.to_string()))?
        .to_string();

    let (path, exists, byte_size) = match requested.canonicalize() {
        Ok(path) => {
            let metadata = fs::metadata(&path)?;
            if !metadata.is_file() {
                return Err(DocumentPathError::InvalidPath(file_path.to_string()));
            }
            (path, true, Some(metadata.len()))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound && kind == DocumentType::Markdown => {
            let parent = requested
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."))
                .canonicalize()?;
            if !parent.is_dir() {
                return Err(DocumentPathError::InvalidPath(file_path.to_string()));
            }
            (parent.join(&display_name), false, None)
        }
        Err(error) => return Err(DocumentPathError::Io(error)),
    };

    Ok(DocumentDescriptor {
        document_type: kind,
        canonical_path: path.to_string_lossy().into_owned(),
        display_name,
        exists,
        byte_size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn detects_supported_document_types_case_insensitively() {
        assert_eq!(
            document_type(Path::new("note.md")),
            Some(DocumentType::Markdown)
        );
        assert_eq!(
            document_type(Path::new("note.MARKDOWN")),
            Some(DocumentType::Markdown)
        );
        assert_eq!(
            document_type(Path::new("scan.PDF")),
            Some(DocumentType::Pdf)
        );
        assert_eq!(
            document_type(Path::new("invoice.ofd")),
            Some(DocumentType::Ofd)
        );
        assert_eq!(document_type(Path::new("note.txt")), None);
    }

    #[test]
    fn inspects_existing_pdf_without_parsing_its_contents() {
        let path =
            std::env::temp_dir().join(format!("mdstudio-p1-type-{}.pdf", std::process::id()));
        fs::write(&path, b"not a PDF; inspection only checks path and type").unwrap();
        let descriptor = inspect_document_path(path.to_str().unwrap()).unwrap();
        assert_eq!(descriptor.document_type, DocumentType::Pdf);
        assert!(descriptor.exists);
        assert_eq!(
            descriptor.byte_size,
            Some(fs::metadata(&path).unwrap().len())
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reader_rejects_pdf_and_ofd_before_markdown_parsing() {
        for extension in ["pdf", "ofd"] {
            let path = std::env::temp_dir().join(format!(
                "mdstudio-p1-disabled-{}-{extension}",
                std::process::id()
            ));
            fs::write(&path, "# 这不是可启用的 Markdown 阅读器输入").unwrap();
            let result = crate::services::reader::load_document(path.to_str().unwrap());
            assert!(matches!(
                result,
                Err(crate::services::reader::ReaderError::InvalidPath(_))
            ));
            fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn allows_missing_markdown_path_for_recovery_but_not_missing_pdf() {
        let parent =
            std::env::temp_dir().join(format!("mdstudio-p1-missing-{}", std::process::id()));
        fs::create_dir_all(&parent).unwrap();
        let markdown = parent.join("缺失 文件.md");
        let markdown_descriptor = inspect_document_path(markdown.to_str().unwrap()).unwrap();
        assert_eq!(markdown_descriptor.document_type, DocumentType::Markdown);
        assert!(!markdown_descriptor.exists);
        let pdf = PathBuf::from(parent.join("missing.pdf"));
        assert!(inspect_document_path(pdf.to_str().unwrap()).is_err());
        fs::remove_dir_all(parent).unwrap();
    }
}
