use base64::{engine::general_purpose::STANDARD, Engine};
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use thiserror::Error;

const HIDDEN_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "target",
    ".next",
    ".cache",
    "System Volume Information",
    "$RECYCLE.BIN",
];

#[derive(Debug, Error)]
pub enum FileServiceError {
    #[error("只支持 .md 和 .markdown 文件：{0}")]
    InvalidMarkdownPath(String),
    #[error("文件或目录不存在：{0}")]
    NotFound(String),
    #[error("目标文件已存在：{0}")]
    AlreadyExists(String),
    #[error("文件已在磁盘上发生变化，请先重新加载或另存为：{0}")]
    Conflict(String),
    #[error("文件不是有效的 UTF-8 Markdown 文本：{0}")]
    InvalidUtf8(String),
    #[error("不允许读取文档目录之外的图片：{0}")]
    UnsafeAsset(String),
    #[error("不支持的图片类型：{0}")]
    UnsupportedImage(String),
    #[error("图片数据无效或与文件类型不匹配")]
    InvalidImageData,
    #[error("图片超过 20 MiB 限制")]
    ImageTooLarge,
    #[error("文件系统错误：{0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
}

impl LineEnding {
    fn from_name(value: &str) -> Self {
        match value {
            "crlf" => Self::Crlf,
            "cr" => Self::Cr,
            _ => Self::Lf,
        }
    }

    #[cfg(test)]
    fn as_str(self) -> &'static str {
        match self {
            Self::Lf => "lf",
            Self::Crlf => "crlf",
            Self::Cr => "cr",
        }
    }

    fn apply(self, content: &str) -> Vec<u8> {
        let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
        let serialized = match self {
            Self::Lf => normalized,
            Self::Crlf => normalized.replace('\n', "\r\n"),
            Self::Cr => normalized.replace('\n', "\r"),
        };
        serialized.into_bytes()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub file_path: String,
    pub content: String,
    pub disk_version_hash: String,
    pub bom: bool,
    pub line_ending: LineEnding,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub file_path: String,
    pub disk_version_hash: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetSaveResult {
    pub relative_path: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub file_path: String,
    pub disk_version_hash: String,
    pub byte_size: u64,
    pub modified_unix_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionCheck {
    pub changed: bool,
    pub disk_version_hash: String,
}

pub fn open_document(file_path: &str) -> Result<DocumentSnapshot, FileServiceError> {
    validate_markdown_path(file_path)?;
    let bytes = fs::read(file_path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            FileServiceError::NotFound(file_path.into())
        } else {
            FileServiceError::Io(error)
        }
    })?;
    let disk_version_hash = hash_bytes(&bytes);
    let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let text_bytes = if bom { &bytes[3..] } else { &bytes[..] };
    let decoded = std::str::from_utf8(text_bytes)
        .map_err(|_| FileServiceError::InvalidUtf8(file_path.into()))?;
    let line_ending = detect_line_ending(decoded);
    let content = decoded.replace("\r\n", "\n").replace('\r', "\n");

    Ok(DocumentSnapshot {
        file_path: path_string(Path::new(file_path)),
        content,
        disk_version_hash,
        bom,
        line_ending,
    })
}

pub fn save_document(
    file_path: &str,
    content: &str,
    expected_hash: Option<&str>,
    bom: bool,
    line_ending: &str,
) -> Result<SaveResult, FileServiceError> {
    validate_markdown_path(file_path)?;
    let target = Path::new(file_path);
    let current = read_optional_bytes(target)?;
    match (expected_hash, current.as_deref()) {
        (None, Some(_)) => return Err(FileServiceError::AlreadyExists(file_path.into())),
        (Some(_), None) => return Err(FileServiceError::Conflict(file_path.into())),
        (Some(expected), Some(bytes)) if hash_bytes(bytes) != expected => {
            return Err(FileServiceError::Conflict(file_path.into()));
        }
        _ => {}
    }

    let ending = LineEnding::from_name(line_ending);
    let mut bytes = ending.apply(content);
    if bom {
        bytes.splice(0..0, [0xEF, 0xBB, 0xBF]);
    }
    atomic_replace(target, &bytes, current.as_deref())?;

    Ok(SaveResult {
        file_path: path_string(target),
        disk_version_hash: hash_bytes(&bytes),
        byte_size: bytes.len() as u64,
    })
}

pub fn create_markdown_file(file_path: &str) -> Result<SaveResult, FileServiceError> {
    save_document(file_path, "", None, false, "lf")
}

pub fn document_exists(file_path: &str) -> Result<bool, FileServiceError> {
    validate_markdown_path(file_path)?;
    Ok(Path::new(file_path).is_file())
}

pub fn get_file_info(file_path: &str) -> Result<FileInfo, FileServiceError> {
    validate_markdown_path(file_path)?;
    let path = Path::new(file_path);
    let bytes = fs::read(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            FileServiceError::NotFound(file_path.into())
        } else {
            FileServiceError::Io(error)
        }
    })?;
    let metadata = fs::metadata(path)?;
    let modified_unix_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis());
    Ok(FileInfo {
        file_path: path_string(path),
        disk_version_hash: hash_bytes(&bytes),
        byte_size: bytes.len() as u64,
        modified_unix_ms,
    })
}

pub fn check_document_version(
    file_path: &str,
    expected_hash: &str,
) -> Result<VersionCheck, FileServiceError> {
    let info = get_file_info(file_path)?;
    Ok(VersionCheck {
        changed: info.disk_version_hash != expected_hash,
        disk_version_hash: info.disk_version_hash,
    })
}

pub fn read_workspace_tree(root_path: &str) -> Result<Vec<TreeNode>, FileServiceError> {
    let root = PathBuf::from(root_path);
    let metadata = fs::metadata(&root).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            FileServiceError::NotFound(root_path.into())
        } else {
            FileServiceError::Io(error)
        }
    })?;
    if !metadata.is_dir() {
        return Err(FileServiceError::NotFound(root_path.into()));
    }
    read_directory(&root, 0)
}

pub fn resolve_local_asset(
    file_path: &str,
    relative_path: &str,
) -> Result<String, FileServiceError> {
    validate_markdown_path(file_path)?;
    let decoded = percent_decode_str(relative_path).decode_utf8_lossy();
    let requested = Path::new(decoded.as_ref());
    if requested.is_absolute()
        || decoded.contains(':')
        || decoded.starts_with("//")
        || decoded.contains('\0')
    {
        return Err(FileServiceError::UnsafeAsset(relative_path.into()));
    }

    let document_parent = Path::new(file_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .canonicalize()?;
    let resolved = document_parent
        .join(requested)
        .canonicalize()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                FileServiceError::NotFound(relative_path.into())
            } else {
                FileServiceError::Io(error)
            }
        })?;
    if !resolved.starts_with(&document_parent) || !resolved.is_file() {
        return Err(FileServiceError::UnsafeAsset(relative_path.into()));
    }
    let mime = image_mime(&resolved)?;
    let bytes = fs::read(resolved)?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

pub fn save_document_asset(
    file_path: &str,
    asset_id: &str,
    extension: &str,
    mime_type: &str,
    base64_content: &str,
) -> Result<AssetSaveResult, FileServiceError> {
    validate_markdown_path(file_path)?;
    if asset_id.len() != 36
        || !asset_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    {
        return Err(FileServiceError::UnsafeAsset(asset_id.into()));
    }
    let (extension, expected_mime) = match extension.to_ascii_lowercase().as_str() {
        "png" => ("png", "image/png"),
        "jpg" | "jpeg" => ("jpg", "image/jpeg"),
        "gif" => ("gif", "image/gif"),
        "webp" => ("webp", "image/webp"),
        "avif" => ("avif", "image/avif"),
        _ => return Err(FileServiceError::UnsupportedImage(extension.into())),
    };
    if mime_type != expected_mime {
        return Err(FileServiceError::InvalidImageData);
    }
    if base64_content.len() > 28 * 1024 * 1024 {
        return Err(FileServiceError::ImageTooLarge);
    }
    let bytes = STANDARD
        .decode(base64_content)
        .map_err(|_| FileServiceError::InvalidImageData)?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err(FileServiceError::ImageTooLarge);
    }
    if !matches_image_signature(extension, &bytes) {
        return Err(FileServiceError::InvalidImageData);
    }

    let document = Path::new(file_path);
    let parent = document.parent().unwrap_or_else(|| Path::new("."));
    let canonical_parent = parent.canonicalize()?;
    let stem = document
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let directory_name = format!("{stem}_assets");
    let directory = parent.join(&directory_name);
    match fs::create_dir(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(FileServiceError::Io(error)),
    }
    let canonical_directory = directory.canonicalize()?;
    if !canonical_directory.starts_with(&canonical_parent) || !canonical_directory.is_dir() {
        return Err(FileServiceError::UnsafeAsset(
            directory.display().to_string(),
        ));
    }
    let destination = canonical_directory.join(format!("{asset_id}.{extension}"));
    if destination.exists() {
        let existing = fs::read(&destination)?;
        if existing == bytes {
            return Ok(AssetSaveResult {
                relative_path: asset_relative_path(&directory_name, asset_id, extension),
                byte_size: bytes.len() as u64,
            });
        }
        return Err(FileServiceError::AlreadyExists(
            destination.display().to_string(),
        ));
    }

    let mut temporary = NamedTempFile::new_in(&canonical_directory)?;
    temporary.write_all(&bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist_noclobber(&destination)
        .map_err(|error| FileServiceError::Io(error.error))?;
    #[cfg(unix)]
    File::open(&canonical_directory)?.sync_all()?;

    Ok(AssetSaveResult {
        relative_path: asset_relative_path(&directory_name, asset_id, extension),
        byte_size: bytes.len() as u64,
    })
}

fn asset_relative_path(directory_name: &str, asset_id: &str, extension: &str) -> String {
    format!(
        "{}/{asset_id}.{extension}",
        utf8_percent_encode(directory_name, NON_ALPHANUMERIC)
    )
}

fn matches_image_signature(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "avif" => {
            bytes.len() >= 12
                && &bytes[4..8] == b"ftyp"
                && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis")
        }
        _ => false,
    }
}

fn atomic_replace(
    target: &Path,
    bytes: &[u8],
    previous_bytes: Option<&[u8]>,
) -> Result<(), FileServiceError> {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(FileServiceError::NotFound(parent.display().to_string()));
    }

    let permissions = if previous_bytes.is_some() {
        fs::metadata(target)
            .ok()
            .map(|metadata| metadata.permissions())
    } else {
        None
    };
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    if let Some(permissions) = permissions {
        temporary.as_file().set_permissions(permissions)?;
    }

    // 同目录临时文件确保替换在同一文件系统内进行；具体原子性依赖平台的 rename 实现。
    temporary
        .persist(target)
        .map_err(|error| FileServiceError::Io(error.error))?;
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}

fn read_optional_bytes(path: &Path) -> Result<Option<Vec<u8>>, FileServiceError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(FileServiceError::Io(error)),
    }
}

fn read_directory(path: &Path, depth: usize) -> Result<Vec<TreeNode>, FileServiceError> {
    if depth > 24 {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_directory = file_type.is_dir();
        if is_directory {
            if name.starts_with('.') || HIDDEN_DIRS.contains(&name.as_str()) {
                continue;
            }
            let children = read_directory(&entry_path, depth + 1)?;
            entries.push(TreeNode {
                name,
                path: path_string(&entry_path),
                is_directory: true,
                children,
            });
        } else if file_type.is_file() && is_markdown_path(&entry_path) {
            entries.push(TreeNode {
                name,
                path: path_string(&entry_path),
                is_directory: false,
                children: Vec::new(),
            });
        }
    }
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

fn validate_markdown_path(file_path: &str) -> Result<(), FileServiceError> {
    if !is_markdown_path(Path::new(file_path)) {
        return Err(FileServiceError::InvalidMarkdownPath(file_path.into()));
    }
    Ok(())
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn detect_line_ending(content: &str) -> LineEnding {
    let crlf = content.matches("\r\n").count();
    let lf = content.matches('\n').count().saturating_sub(crlf);
    let cr = content.matches('\r').count().saturating_sub(crlf);
    if crlf >= lf && crlf >= cr && crlf > 0 {
        LineEnding::Crlf
    } else if cr > lf && cr > 0 {
        LineEnding::Cr
    } else {
        LineEnding::Lf
    }
}

fn hash_bytes(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn image_mime(path: &Path) -> Result<&'static str, FileServiceError> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Ok("image/png"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "gif" => Ok("image/gif"),
        "webp" => Ok("image/webp"),
        "avif" => Ok("image/avif"),
        extension => Err(FileServiceError::UnsupportedImage(extension.into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_bom_and_crlf_and_detects_conflict() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("中文.md");
        let original_bytes: [u8; 21] = [
            0xEF, 0xBB, 0xBF, b'#', b' ', 0xE4, 0xBD, 0xA0, 0xE5, 0xA5, 0xBD, 0x0D, 0x0A, 0x0D,
            0x0A, b'B', b'o', b'd', b'y', 0x0D, 0x0A,
        ];
        fs::write(&path, original_bytes).unwrap();
        let opened = open_document(path.to_str().unwrap()).unwrap();
        assert!(opened.bom);
        assert_eq!(opened.line_ending, LineEnding::Crlf);
        assert_eq!(opened.content, "# 你好\n\nBody\n");

        let saved = save_document(
            path.to_str().unwrap(),
            "# 你好\n改好了\n",
            Some(&opened.disk_version_hash),
            opened.bom,
            opened.line_ending.as_str(),
        )
        .unwrap();
        let expected_bytes: [u8; 24] = [
            0xEF, 0xBB, 0xBF, b'#', b' ', 0xE4, 0xBD, 0xA0, 0xE5, 0xA5, 0xBD, 0x0D, 0x0A, 0xE6,
            0x94, 0xB9, 0xE5, 0xA5, 0xBD, 0xE4, 0xBA, 0x86, 0x0D, 0x0A,
        ];
        assert_eq!(fs::read(&path).unwrap(), expected_bytes);
        assert_ne!(saved.disk_version_hash, opened.disk_version_hash);

        let conflict = save_document(
            path.to_str().unwrap(),
            "# 外部写入\n",
            Some(&opened.disk_version_hash),
            false,
            "lf",
        );
        assert!(matches!(conflict, Err(FileServiceError::Conflict(_))));
    }

    #[test]
    fn round_trips_advanced_markdown_fixtures_without_rewriting_source() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("tests/fixtures/advanced-markdown");
        let temporary = tempfile::tempdir().unwrap();
        let mut paths: Vec<_> = fs::read_dir(fixtures)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "md"))
            .collect();
        paths.sort();
        assert_eq!(paths.len(), 8);

        for source_path in paths {
            let file_name = source_path.file_name().unwrap();
            let destination = temporary.path().join(file_name);
            let original_bytes = fs::read(&source_path).unwrap();
            fs::write(&destination, &original_bytes).unwrap();

            let opened = open_document(destination.to_str().unwrap()).unwrap();
            save_document(
                destination.to_str().unwrap(),
                &opened.content,
                Some(&opened.disk_version_hash),
                opened.bom,
                opened.line_ending.as_str(),
            )
            .unwrap();

            assert_eq!(
                fs::read(&destination).unwrap(),
                original_bytes,
                "{}",
                file_name.to_string_lossy()
            );
        }
    }

    #[test]
    fn saves_valid_image_to_safe_document_asset_directory_and_is_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        let document = directory.path().join("设计 文档.md");
        fs::write(&document, "# 图片\n").unwrap();
        let png = [b"\x89PNG\r\n\x1a\n".as_slice(), b"pixel"].concat();
        let encoded = STANDARD.encode(&png);
        let first = save_document_asset(
            document.to_str().unwrap(),
            "12345678-1234-1234-1234-123456789abc",
            "png",
            "image/png",
            &encoded,
        )
        .unwrap();
        assert_eq!(first.relative_path, "%E8%AE%BE%E8%AE%A1%20%E6%96%87%E6%A1%A3%5Fassets/12345678-1234-1234-1234-123456789abc.png");
        assert_eq!(
            fs::read(
                directory
                    .path()
                    .join("设计 文档_assets/12345678-1234-1234-1234-123456789abc.png")
            )
            .unwrap(),
            png
        );
        let second = save_document_asset(
            document.to_str().unwrap(),
            "12345678-1234-1234-1234-123456789abc",
            "png",
            "image/png",
            &encoded,
        )
        .unwrap();
        assert_eq!(first.relative_path, second.relative_path);
    }

    #[test]
    fn rejects_asset_traversal_and_mismatched_image_content() {
        let directory = tempfile::tempdir().unwrap();
        let document = directory.path().join("notes.md");
        fs::write(&document, "").unwrap();
        let invalid_id = save_document_asset(
            document.to_str().unwrap(),
            "../../outside",
            "png",
            "image/png",
            &STANDARD.encode(b"not a png"),
        );
        assert!(matches!(invalid_id, Err(FileServiceError::UnsafeAsset(_))));
        let invalid_image = save_document_asset(
            document.to_str().unwrap(),
            "12345678-1234-1234-1234-123456789abc",
            "png",
            "image/png",
            &STANDARD.encode(b"not a png"),
        );
        assert!(matches!(
            invalid_image,
            Err(FileServiceError::InvalidImageData)
        ));
        assert!(!directory.path().join("notes_assets").exists());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_write_through_a_symlinked_asset_directory() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let document = directory.path().join("notes.md");
        fs::write(&document, "").unwrap();
        symlink(outside.path(), directory.path().join("notes_assets")).unwrap();
        let png = [b"\x89PNG\r\n\x1a\n".as_slice(), b"pixel"].concat();
        let result = save_document_asset(
            document.to_str().unwrap(),
            "12345678-1234-1234-1234-123456789abc",
            "png",
            "image/png",
            &STANDARD.encode(png),
        );
        assert!(matches!(result, Err(FileServiceError::UnsafeAsset(_))));
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[test]
    fn creates_tree_without_hidden_directories_or_non_markdown_files() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("docs")).unwrap();
        fs::create_dir(directory.path().join(".git")).unwrap();
        fs::write(directory.path().join("README.md"), "hi").unwrap();
        fs::write(directory.path().join("notes.markdown"), "hi").unwrap();
        fs::write(directory.path().join("data.txt"), "hi").unwrap();
        fs::write(directory.path().join(".git/secret.md"), "hi").unwrap();

        let tree = read_workspace_tree(directory.path().to_str().unwrap()).unwrap();
        assert_eq!(tree.len(), 3);
        assert!(tree
            .iter()
            .any(|node| node.name == "docs" && node.is_directory));
        assert!(tree.iter().any(|node| node.name == "README.md"));
    }

    #[test]
    fn local_asset_resolution_rejects_parent_traversal() {
        let directory = tempfile::tempdir().unwrap();
        let docs = directory.path().join("docs");
        fs::create_dir(&docs).unwrap();
        let markdown = docs.join("note.md");
        let image = docs.join("image.png");
        let outside = directory.path().join("outside.png");
        fs::write(&markdown, "").unwrap();
        fs::write(&image, [1, 2, 3]).unwrap();
        fs::write(&outside, [4, 5, 6]).unwrap();

        let data = resolve_local_asset(markdown.to_str().unwrap(), "image.png").unwrap();
        assert_eq!(data, "data:image/png;base64,AQID");
        let escaped = resolve_local_asset(markdown.to_str().unwrap(), "../outside.png");
        assert!(matches!(escaped, Err(FileServiceError::UnsafeAsset(_))));
    }
}
