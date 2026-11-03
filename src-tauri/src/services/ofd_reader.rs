use crate::services::documents::{self, DocumentType};
use crc32fast::hash as crc32;
use flate2::read::DeflateDecoder;
use quick_xml::{
    events::{BytesStart, Event},
    Reader as XmlReader, XmlVersion,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::{self, File},
    io::{self, Read},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::UNIX_EPOCH,
};
use thiserror::Error;

pub const MAX_OFD_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_XML_BYTES: u64 = 8 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES: u64 = 32 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 200;
const MAX_PAGES: u32 = 20_000;
const MAX_FONT_RESOURCES: usize = 128;
const MAX_FONT_CHARS: usize = 8_192;
const IO_CHUNK_BYTES: usize = 64 * 1024;
const MAX_EARLY_CANCELLATIONS: usize = 256;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfdDocumentInfo {
    pub canonical_path: String,
    pub display_name: String,
    pub byte_size: u64,
    pub modified_unix_micros: u64,
    pub page_count: u32,
    pub has_signatures: bool,
    pub resource_warnings: Vec<String>,
    pub font_resources: Vec<OfdFontResource>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfdFontResource {
    pub id: String,
    pub font_name: String,
    pub family_name: Option<String>,
    pub charset: String,
    pub serif: bool,
    pub bold: bool,
    pub italic: bool,
    pub fixed_size: bool,
    pub required_characters: String,
}

#[derive(Debug, Error)]
pub enum OfdReaderError {
    #[error("OFD 文件路径无效或文件不存在")]
    InvalidPath,
    #[error("OFD 文件超过 128 MiB 的读取上限")]
    TooLarge,
    #[error("OFD 容器无效或已损坏")]
    InvalidContainer,
    #[error("OFD ZIP 条目超过安全限制")]
    ResourceLimit,
    #[error("OFD 文件包含加密内容；当前版本不支持加密 OFD")]
    Encrypted,
    #[error("OFD.xml 缺失或无效")]
    MissingManifest,
    #[error("OFD 文档入口无效或不在容器内")]
    InvalidDocumentRoot,
    #[error("OFD XML 无法安全解析：{0}")]
    InvalidXml(String),
    #[error("OFD 路径引用包含不安全路径")]
    UnsafeResourcePath,
    #[error("OFD 文档没有有效页面")]
    NoPages,
    #[error("OFD 文件在读取期间已发生变化，请重新打开")]
    Changed,
    #[error("OFD 二进制读取已取消")]
    Cancelled,
    #[error("读取 OFD 文件失败：{0}")]
    Io(#[from] io::Error),
    #[error("OFD 读取请求 ID 无效")]
    InvalidRequestId,
    #[error("OFD 读取请求 ID 已在使用")]
    DuplicateRequestId,
    #[error("OFD 读取状态不可用")]
    RegistryUnavailable,
}

#[derive(Debug, Clone)]
struct ZipEntry {
    name: String,
    flags: u16,
    method: u16,
    crc32: u32,
    compressed_size: u64,
    uncompressed_size: u64,
    local_offset: u64,
    is_directory: bool,
}

#[derive(Default)]
struct XmlSummary {
    document_root: Option<String>,
    page_count: u32,
    resource_refs: Vec<String>,
    font_resources: Vec<OfdFontResource>,
    font_characters: HashMap<String, HashSet<char>>,
    encrypted: bool,
}

pub fn inspect_ofd_document(file_path: &str) -> Result<OfdDocumentInfo, OfdReaderError> {
    let descriptor =
        documents::inspect_document_path(file_path).map_err(|_| OfdReaderError::InvalidPath)?;
    if descriptor.document_type != DocumentType::Ofd || !descriptor.exists {
        return Err(OfdReaderError::InvalidPath);
    }
    let path = Path::new(&descriptor.canonical_path);
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(OfdReaderError::InvalidPath);
    }
    if metadata.len() > MAX_OFD_BYTES {
        return Err(OfdReaderError::TooLarge);
    }
    let bytes = read_checked_file(path, metadata.len(), &AtomicBool::new(false))?;
    let inspected = inspect_container(&bytes)?;
    Ok(OfdDocumentInfo {
        canonical_path: descriptor.canonical_path,
        display_name: descriptor.display_name,
        byte_size: metadata.len(),
        modified_unix_micros: modified_unix_micros(&metadata),
        page_count: inspected.page_count,
        has_signatures: inspected.has_signatures,
        resource_warnings: inspected.resource_warnings,
        font_resources: inspected.font_resources,
    })
}

pub fn read_ofd_document(
    file_path: &str,
    expected_byte_size: u64,
    expected_modified_unix_micros: u64,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, OfdReaderError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(OfdReaderError::Cancelled);
    }
    let descriptor =
        documents::inspect_document_path(file_path).map_err(|_| OfdReaderError::InvalidPath)?;
    if descriptor.document_type != DocumentType::Ofd || !descriptor.exists {
        return Err(OfdReaderError::InvalidPath);
    }
    let path = Path::new(&descriptor.canonical_path);
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(OfdReaderError::InvalidPath);
    }
    if metadata.len() > MAX_OFD_BYTES {
        return Err(OfdReaderError::TooLarge);
    }
    if metadata.len() != expected_byte_size
        || modified_unix_micros(&metadata) != expected_modified_unix_micros
    {
        return Err(OfdReaderError::Changed);
    }
    let bytes = read_checked_file(path, metadata.len(), cancelled)?;
    if cancelled.load(Ordering::Acquire) {
        return Err(OfdReaderError::Cancelled);
    }
    inspect_container(&bytes)?;
    if cancelled.load(Ordering::Acquire) {
        return Err(OfdReaderError::Cancelled);
    }
    Ok(bytes)
}

fn modified_unix_micros(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .unwrap_or_default()
        .as_micros()
        .min(u64::MAX as u128) as u64
}

fn read_checked_file(
    path: &Path,
    expected_size: u64,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, OfdReaderError> {
    if expected_size > MAX_OFD_BYTES {
        return Err(OfdReaderError::TooLarge);
    }
    let capacity = usize::try_from(expected_size).map_err(|_| OfdReaderError::TooLarge)?;
    let mut file = File::open(path)?;
    let mut bytes = Vec::with_capacity(capacity);
    let mut buffer = vec![0; IO_CHUNK_BYTES];
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(OfdReaderError::Cancelled);
        }
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() as u64 > expected_size || bytes.len() as u64 > MAX_OFD_BYTES {
            return Err(OfdReaderError::Changed);
        }
    }
    if bytes.len() as u64 != expected_size {
        return Err(OfdReaderError::Changed);
    }
    Ok(bytes)
}

struct InspectedContainer {
    page_count: u32,
    has_signatures: bool,
    resource_warnings: Vec<String>,
    font_resources: Vec<OfdFontResource>,
}

fn inspect_container(bytes: &[u8]) -> Result<InspectedContainer, OfdReaderError> {
    if bytes.len() < 22 || bytes.len() as u64 > MAX_OFD_BYTES {
        return Err(OfdReaderError::InvalidContainer);
    }
    let entries = parse_zip_entries(bytes)?;
    let files = entries
        .iter()
        .filter(|entry| !entry.is_directory)
        .collect::<Vec<_>>();
    if files.iter().any(|entry| entry.flags & 0x0001 != 0) {
        return Err(OfdReaderError::Encrypted);
    }
    let by_name = files
        .iter()
        .map(|entry| (entry.name.as_str(), *entry))
        .collect::<HashMap<_, _>>();
    let manifest = by_name
        .get("OFD.xml")
        .ok_or(OfdReaderError::MissingManifest)?;
    let manifest_xml = read_xml_entry(bytes, manifest)?;
    let manifest_summary = parse_xml(&manifest_xml, "OFD.xml", false)?;
    if manifest_summary.encrypted
        || files
            .iter()
            .any(|entry| entry.name.to_ascii_lowercase().contains("encrypt"))
    {
        return Err(OfdReaderError::Encrypted);
    }
    let root = manifest_summary
        .document_root
        .as_deref()
        .ok_or(OfdReaderError::InvalidDocumentRoot)?;
    validate_resource_path(root)?;
    let document_entry = by_name
        .get(root)
        .ok_or(OfdReaderError::InvalidDocumentRoot)?;
    let document_xml = read_xml_entry(bytes, document_entry)?;
    let document_summary = parse_xml(&document_xml, root, true)?;
    let page_count = document_summary.page_count;
    if page_count == 0 {
        return Err(OfdReaderError::NoPages);
    }
    let mut total_xml = manifest_xml.len() as u64 + document_xml.len() as u64;
    let mut resource_warnings = Vec::new();
    let mut font_resources = HashMap::<String, OfdFontResource>::new();
    let mut font_characters = HashMap::<String, HashSet<char>>::new();
    let mut all_refs = manifest_summary
        .resource_refs
        .into_iter()
        .map(|reference| format!("OFD.xml\u{0}{reference}"))
        .collect::<Vec<_>>();
    all_refs.extend(
        document_summary
            .resource_refs
            .iter()
            .cloned()
            .map(|reference| format!("{root}\u{0}{reference}")),
    );
    merge_font_summary(&mut font_resources, &mut font_characters, document_summary);
    let mut parsed_xml = HashSet::from(["OFD.xml".to_string(), root.to_string()]);
    for entry in &files {
        if entry.name.to_ascii_lowercase().ends_with(".xml")
            && parsed_xml.insert(entry.name.clone())
        {
            total_xml = total_xml.saturating_add(entry.uncompressed_size);
            if total_xml > MAX_TOTAL_XML_BYTES {
                return Err(OfdReaderError::ResourceLimit);
            }
            let xml = read_xml_entry(bytes, entry)?;
            let summary = parse_xml(&xml, &entry.name, false)?;
            if summary.encrypted {
                return Err(OfdReaderError::Encrypted);
            }
            all_refs.extend(
                summary
                    .resource_refs
                    .iter()
                    .cloned()
                    .map(|reference| format!("{}\u{0}{reference}", entry.name)),
            );
            merge_font_summary(&mut font_resources, &mut font_characters, summary);
        }
    }

    for reference in all_refs.into_iter().take(20) {
        let (source, raw_path) = reference
            .split_once('\u{0}')
            .unwrap_or(("OFD.xml", reference.as_str()));
        let resolved = resolve_resource(source, raw_path)?;
        if !archive_contains_resource(&entries, &resolved) {
            resource_warnings.push(format!("{source} 引用的资源缺失：{raw_path}"));
        }
    }
    let has_signatures = files.iter().any(|entry| {
        let name = entry.name.to_ascii_lowercase();
        name.contains("/signs/")
            || name.ends_with("signatures.xml")
            || name.ends_with("signature.xml")
    });
    let mut font_resources = font_resources.into_values().collect::<Vec<_>>();
    font_resources.sort_by(|left, right| left.id.cmp(&right.id));
    for font in &mut font_resources {
        if let Some(characters) = font_characters.remove(&font.id) {
            font.required_characters = characters.into_iter().collect();
        }
    }
    Ok(InspectedContainer {
        page_count,
        has_signatures,
        resource_warnings,
        font_resources,
    })
}

fn merge_font_summary(
    fonts: &mut HashMap<String, OfdFontResource>,
    characters: &mut HashMap<String, HashSet<char>>,
    summary: XmlSummary,
) {
    for font in summary.font_resources {
        if fonts.len() < MAX_FONT_RESOURCES || fonts.contains_key(&font.id) {
            fonts.entry(font.id.clone()).or_insert(font);
        }
    }
    for (font_id, new_chars) in summary.font_characters {
        let existing = characters.entry(font_id).or_default();
        for character in new_chars {
            if existing.len() >= MAX_FONT_CHARS {
                break;
            }
            existing.insert(character);
        }
    }
}

fn parse_zip_entries(bytes: &[u8]) -> Result<Vec<ZipEntry>, OfdReaderError> {
    let lower_bound = bytes.len().saturating_sub(65_557);
    let eocd = (lower_bound..=bytes.len() - 22)
        .rev()
        .find(|offset| read_u32(bytes, *offset) == Some(0x0605_4b50))
        .ok_or(OfdReaderError::InvalidContainer)?;
    let disk = read_u16(bytes, eocd + 4).ok_or(OfdReaderError::InvalidContainer)?;
    let central_disk = read_u16(bytes, eocd + 6).ok_or(OfdReaderError::InvalidContainer)?;
    let disk_entries = read_u16(bytes, eocd + 8).ok_or(OfdReaderError::InvalidContainer)? as usize;
    let total_entries =
        read_u16(bytes, eocd + 10).ok_or(OfdReaderError::InvalidContainer)? as usize;
    let central_size = read_u32(bytes, eocd + 12).ok_or(OfdReaderError::InvalidContainer)? as u64;
    let central_offset = read_u32(bytes, eocd + 16).ok_or(OfdReaderError::InvalidContainer)? as u64;
    let comment_size = read_u16(bytes, eocd + 20).ok_or(OfdReaderError::InvalidContainer)? as usize;
    if disk != 0
        || central_disk != 0
        || disk_entries != total_entries
        || total_entries == 0
        || total_entries > MAX_ENTRIES
        || eocd + 22 + comment_size != bytes.len()
        || central_offset
            .checked_add(central_size)
            .is_none_or(|end| end > eocd as u64)
    {
        return Err(OfdReaderError::ResourceLimit);
    }
    let mut entries = Vec::with_capacity(total_entries);
    let mut names = HashSet::with_capacity(total_entries);
    let mut local_ranges = Vec::with_capacity(total_entries);
    let mut cursor =
        usize::try_from(central_offset).map_err(|_| OfdReaderError::InvalidContainer)?;
    let central_end = usize::try_from(central_offset + central_size)
        .map_err(|_| OfdReaderError::InvalidContainer)?;
    let mut total_uncompressed = 0u64;
    for _ in 0..total_entries {
        if read_u32(bytes, cursor) != Some(0x0201_4b50) || cursor + 46 > central_end {
            return Err(OfdReaderError::InvalidContainer);
        }
        let made_by = read_u16(bytes, cursor + 4).ok_or(OfdReaderError::InvalidContainer)? >> 8;
        let flags = read_u16(bytes, cursor + 8).ok_or(OfdReaderError::InvalidContainer)?;
        let method = read_u16(bytes, cursor + 10).ok_or(OfdReaderError::InvalidContainer)?;
        let crc = read_u32(bytes, cursor + 16).ok_or(OfdReaderError::InvalidContainer)?;
        let compressed = read_u32(bytes, cursor + 20).ok_or(OfdReaderError::InvalidContainer)?;
        let uncompressed = read_u32(bytes, cursor + 24).ok_or(OfdReaderError::InvalidContainer)?;
        let name_len =
            read_u16(bytes, cursor + 28).ok_or(OfdReaderError::InvalidContainer)? as usize;
        let extra_len =
            read_u16(bytes, cursor + 30).ok_or(OfdReaderError::InvalidContainer)? as usize;
        let comment_len =
            read_u16(bytes, cursor + 32).ok_or(OfdReaderError::InvalidContainer)? as usize;
        let start_disk = read_u16(bytes, cursor + 34).ok_or(OfdReaderError::InvalidContainer)?;
        let external_attrs =
            read_u32(bytes, cursor + 38).ok_or(OfdReaderError::InvalidContainer)?;
        let local_offset = read_u32(bytes, cursor + 42).ok_or(OfdReaderError::InvalidContainer)?;
        let record_end = cursor
            .checked_add(46 + name_len + extra_len + comment_len)
            .ok_or(OfdReaderError::InvalidContainer)?;
        if record_end > central_end
            || compressed == u32::MAX
            || uncompressed == u32::MAX
            || local_offset == u32::MAX
            || start_disk != 0
        {
            return Err(OfdReaderError::ResourceLimit);
        }
        let name_bytes = bytes
            .get(cursor + 46..cursor + 46 + name_len)
            .ok_or(OfdReaderError::InvalidContainer)?;
        let name = std::str::from_utf8(name_bytes)
            .map_err(|_| OfdReaderError::UnsafeResourcePath)?
            .to_string();
        validate_zip_path(&name)?;
        if !names.insert(name.clone()) {
            return Err(OfdReaderError::InvalidContainer);
        }
        if made_by == 3 {
            let mode = external_attrs >> 16;
            if mode & 0o170000 == 0o120000 {
                return Err(OfdReaderError::UnsafeResourcePath);
            }
        }
        let compressed_size = compressed as u64;
        let uncompressed_size = uncompressed as u64;
        if uncompressed_size > MAX_ENTRY_BYTES
            || compressed_size > MAX_OFD_BYTES
            || (uncompressed_size > 0
                && (compressed_size == 0
                    || uncompressed_size > compressed_size.saturating_mul(MAX_COMPRESSION_RATIO)))
        {
            return Err(OfdReaderError::ResourceLimit);
        }
        total_uncompressed = total_uncompressed
            .checked_add(uncompressed_size)
            .ok_or(OfdReaderError::ResourceLimit)?;
        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES || !matches!(method, 0 | 8) {
            return Err(OfdReaderError::ResourceLimit);
        }
        let local_offset = local_offset as u64;
        let local = usize::try_from(local_offset).map_err(|_| OfdReaderError::InvalidContainer)?;
        if read_u32(bytes, local) != Some(0x0403_4b50) || local + 30 > bytes.len() {
            return Err(OfdReaderError::InvalidContainer);
        }
        let local_flags = read_u16(bytes, local + 6).ok_or(OfdReaderError::InvalidContainer)?;
        let local_method = read_u16(bytes, local + 8).ok_or(OfdReaderError::InvalidContainer)?;
        let local_name_len =
            read_u16(bytes, local + 26).ok_or(OfdReaderError::InvalidContainer)? as usize;
        let local_extra_len =
            read_u16(bytes, local + 28).ok_or(OfdReaderError::InvalidContainer)? as usize;
        let local_name = bytes
            .get(local + 30..local + 30 + local_name_len)
            .ok_or(OfdReaderError::InvalidContainer)?;
        let data_start = local
            .checked_add(30 + local_name_len + local_extra_len)
            .ok_or(OfdReaderError::InvalidContainer)?;
        let data_end = data_start
            .checked_add(compressed_size as usize)
            .ok_or(OfdReaderError::InvalidContainer)?;
        if local_flags != flags
            || local_method != method
            || local_name != name_bytes
            || data_end > central_offset as usize
        {
            return Err(OfdReaderError::InvalidContainer);
        }
        local_ranges.push((local, data_end));
        entries.push(ZipEntry {
            is_directory: name.ends_with('/'),
            name,
            flags,
            method,
            crc32: crc,
            compressed_size,
            uncompressed_size,
            local_offset,
        });
        cursor = record_end;
    }
    if cursor != central_end {
        return Err(OfdReaderError::InvalidContainer);
    }
    local_ranges.sort_unstable();
    if local_ranges.windows(2).any(|range| range[0].1 > range[1].0) {
        return Err(OfdReaderError::InvalidContainer);
    }
    Ok(entries)
}

fn validate_zip_path(path: &str) -> Result<(), OfdReaderError> {
    let path_without_slash = path.strip_suffix('/').unwrap_or(path);
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains(':')
        || path.chars().any(char::is_control)
        || path_without_slash
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(OfdReaderError::UnsafeResourcePath);
    }
    Ok(())
}

fn validate_resource_path(path: &str) -> Result<(), OfdReaderError> {
    let path = path.strip_prefix("/").unwrap_or(path);
    validate_zip_path(path.strip_prefix("./").unwrap_or(path))
}

fn read_xml_entry(bytes: &[u8], entry: &ZipEntry) -> Result<Vec<u8>, OfdReaderError> {
    if !entry.name.to_ascii_lowercase().ends_with(".xml") || entry.uncompressed_size > MAX_XML_BYTES
    {
        return Err(OfdReaderError::ResourceLimit);
    }
    let local =
        usize::try_from(entry.local_offset).map_err(|_| OfdReaderError::InvalidContainer)?;
    let name_len = read_u16(bytes, local + 26).ok_or(OfdReaderError::InvalidContainer)? as usize;
    let extra_len = read_u16(bytes, local + 28).ok_or(OfdReaderError::InvalidContainer)? as usize;
    let begin = local
        .checked_add(30 + name_len + extra_len)
        .ok_or(OfdReaderError::InvalidContainer)?;
    let end = begin
        .checked_add(entry.compressed_size as usize)
        .ok_or(OfdReaderError::InvalidContainer)?;
    let compressed = bytes
        .get(begin..end)
        .ok_or(OfdReaderError::InvalidContainer)?;
    let mut xml = Vec::with_capacity(entry.uncompressed_size as usize);
    match entry.method {
        0 => xml.extend_from_slice(compressed),
        8 => {
            DeflateDecoder::new(compressed)
                .take(MAX_XML_BYTES + 1)
                .read_to_end(&mut xml)?;
        }
        _ => return Err(OfdReaderError::InvalidContainer),
    };
    if xml.len() as u64 != entry.uncompressed_size
        || xml.len() as u64 > MAX_XML_BYTES
        || crc32(&xml) != entry.crc32
    {
        return Err(OfdReaderError::InvalidContainer);
    }
    Ok(xml)
}

fn parse_xml(xml: &[u8], name: &str, count_pages: bool) -> Result<XmlSummary, OfdReaderError> {
    let mut reader = XmlReader::from_reader(xml);
    reader.config_mut().check_end_names = true;
    let mut buffer = Vec::new();
    let mut summary = XmlSummary::default();
    let mut capture_doc_root = false;
    let mut capture_text_code = false;
    let mut current_text_font: Option<String> = None;
    let mut doc_root_text = String::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let local = event.local_name();
                let local = local.as_ref();
                if count_pages && local == "Page" {
                    summary.page_count = summary.page_count.saturating_add(1);
                    if summary.page_count > MAX_PAGES {
                        return Err(OfdReaderError::ResourceLimit);
                    }
                }
                if local.eq_ignore_ascii_case("Encryptions")
                    || local.eq_ignore_ascii_case("Encryption")
                {
                    summary.encrypted = true;
                }
                if local == "Font" {
                    if let Some(font) = parse_font_resource(&event, name)? {
                        if summary.font_resources.len() < MAX_FONT_RESOURCES {
                            summary.font_resources.push(font);
                        }
                    }
                }
                if local == "TextObject" {
                    current_text_font = read_attribute(&event, "Font", name)?;
                }
                if local == "TextCode" && current_text_font.is_some() {
                    capture_text_code = true;
                }
                capture_doc_root = local == "DocRoot";
                if capture_doc_root {
                    doc_root_text.clear();
                }
                for attribute in event.attributes().with_checks(true) {
                    let attribute = attribute
                        .map_err(|error| OfdReaderError::InvalidXml(format!("{name}: {error}")))?;
                    let key = attribute.key.local_name();
                    if key.as_ref() == "DocRoot" {
                        let value = attribute
                            .normalized_value(XmlVersion::Implicit1_0)
                            .map_err(|error| {
                                OfdReaderError::InvalidXml(format!("{name}: {error}"))
                            })?;
                        summary.document_root = Some(value.into_owned());
                    }
                    if key.as_ref() == "FileLoc" || key.as_ref() == "BaseLoc" {
                        let value = attribute
                            .normalized_value(XmlVersion::Implicit1_0)
                            .map_err(|error| {
                                OfdReaderError::InvalidXml(format!("{name}: {error}"))
                            })?;
                        let value = value.trim();
                        if !value.is_empty() {
                            validate_resource_path(value)?;
                            summary.resource_refs.push(value.to_string());
                        }
                    }
                }
            }
            Ok(Event::Empty(event)) => {
                let local = event.local_name();
                if count_pages && local.as_ref() == "Page" {
                    summary.page_count = summary.page_count.saturating_add(1);
                    if summary.page_count > MAX_PAGES {
                        return Err(OfdReaderError::ResourceLimit);
                    }
                }
                if local.as_ref().eq_ignore_ascii_case("Encryptions")
                    || local.as_ref().eq_ignore_ascii_case("Encryption")
                {
                    summary.encrypted = true;
                }
                if local.as_ref() == "Font" {
                    if let Some(font) = parse_font_resource(&event, name)? {
                        if summary.font_resources.len() < MAX_FONT_RESOURCES {
                            summary.font_resources.push(font);
                        }
                    }
                }
                for attribute in event.attributes().with_checks(true) {
                    let attribute = attribute
                        .map_err(|error| OfdReaderError::InvalidXml(format!("{name}: {error}")))?;
                    let key = attribute.key.local_name();
                    if key.as_ref() == "DocRoot" {
                        let value = attribute
                            .normalized_value(XmlVersion::Implicit1_0)
                            .map_err(|error| {
                                OfdReaderError::InvalidXml(format!("{name}: {error}"))
                            })?;
                        summary.document_root = Some(value.into_owned());
                    }
                    if key.as_ref() == "FileLoc" || key.as_ref() == "BaseLoc" {
                        let value = attribute
                            .normalized_value(XmlVersion::Implicit1_0)
                            .map_err(|error| {
                                OfdReaderError::InvalidXml(format!("{name}: {error}"))
                            })?;
                        let value = value.trim();
                        if !value.is_empty() {
                            validate_resource_path(value)?;
                            summary.resource_refs.push(value.to_string());
                        }
                    }
                }
                capture_doc_root = false;
            }
            Ok(Event::Text(event)) => {
                let value = event.xml10_content();
                if capture_doc_root {
                    doc_root_text.push_str(value.as_ref());
                }
                if capture_text_code {
                    if let Some(font_id) = current_text_font.as_deref() {
                        let chars = summary
                            .font_characters
                            .entry(font_id.to_string())
                            .or_default();
                        for character in value.chars() {
                            if chars.len() >= MAX_FONT_CHARS {
                                break;
                            }
                            chars.insert(character);
                        }
                    }
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                let name = reference.as_ref();
                let resolved = reference
                    .resolve_char_ref()
                    .map_err(|error| OfdReaderError::InvalidXml(format!("{name}: {error}")))?
                    .or_else(|| match name {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "apos" => Some('\''),
                        "quot" => Some('"'),
                        _ => None,
                    })
                    .ok_or_else(|| OfdReaderError::InvalidXml(format!("{name}: 未知实体引用")))?;
                if capture_doc_root {
                    doc_root_text.push(resolved);
                }
                if capture_text_code {
                    if let Some(font_id) = current_text_font.as_deref() {
                        let chars = summary
                            .font_characters
                            .entry(font_id.to_string())
                            .or_default();
                        if chars.len() < MAX_FONT_CHARS {
                            chars.insert(resolved);
                        }
                    }
                }
            }
            Ok(Event::End(event)) => {
                let local = event.local_name();
                if local.as_ref() == "DocRoot" {
                    let value = doc_root_text.trim();
                    if !value.is_empty() {
                        summary.document_root = Some(value.to_string());
                    }
                    capture_doc_root = false;
                }
                if local.as_ref() == "TextCode" {
                    capture_text_code = false;
                }
                if local.as_ref() == "TextObject" {
                    current_text_font = None;
                }
            }
            Ok(Event::DocType(_)) => {
                return Err(OfdReaderError::InvalidXml(format!("{name}: 禁止 DTD")))
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(OfdReaderError::InvalidXml(format!("{name}: {error}"))),
        }
        buffer.clear();
    }
    if reader.buffer_position() == 0 {
        return Err(OfdReaderError::InvalidXml(format!("{name}: 空 XML")));
    }
    Ok(summary)
}

fn read_attribute(
    event: &BytesStart<'_>,
    expected: &str,
    xml_name: &str,
) -> Result<Option<String>, OfdReaderError> {
    for attribute in event.attributes().with_checks(true) {
        let attribute = attribute
            .map_err(|error| OfdReaderError::InvalidXml(format!("{xml_name}: {error}")))?;
        if attribute.key.local_name().as_ref() == expected {
            let value = attribute
                .normalized_value(XmlVersion::Implicit1_0)
                .map_err(|error| OfdReaderError::InvalidXml(format!("{xml_name}: {error}")))?;
            return Ok(Some(value.into_owned()));
        }
    }
    Ok(None)
}

fn parse_font_resource(
    event: &BytesStart<'_>,
    xml_name: &str,
) -> Result<Option<OfdFontResource>, OfdReaderError> {
    let mut values = HashMap::<String, String>::new();
    for attribute in event.attributes().with_checks(true) {
        let attribute = attribute
            .map_err(|error| OfdReaderError::InvalidXml(format!("{xml_name}: {error}")))?;
        let key = attribute.key.local_name().as_ref().to_string();
        let value = attribute
            .normalized_value(XmlVersion::Implicit1_0)
            .map_err(|error| OfdReaderError::InvalidXml(format!("{xml_name}: {error}")))?
            .into_owned();
        values.insert(key, value);
    }
    let Some(id) = values
        .get("ID")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let font_name = values
        .get("FontName")
        .or_else(|| values.get("FamilyName"))
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if font_name.is_empty() || font_name.len() > 256 {
        return Ok(None);
    }
    let flag = |name: &str, alternate: Option<&str>| {
        values
            .get(name)
            .or_else(|| alternate.and_then(|key| values.get(key)))
            .is_some_and(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "true" | "1" | "yes"
                )
            })
    };
    Ok(Some(OfdFontResource {
        id: id.to_string(),
        font_name,
        family_name: values
            .get("FamilyName")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        charset: values
            .get("Charset")
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "unicode".to_string()),
        serif: flag("Serif", None),
        bold: flag("Bold", None),
        italic: flag("Italic", None),
        fixed_size: flag("FixedSize", Some("FixedWidth")),
        required_characters: String::new(),
    }))
}

fn resolve_resource(source_xml: &str, reference: &str) -> Result<String, OfdReaderError> {
    validate_resource_path(reference)?;
    if let Some(root_relative) = reference.strip_prefix('/') {
        return Ok(root_relative.to_string());
    }
    let mut parts = source_xml.split('/').collect::<Vec<_>>();
    parts.pop();
    for part in reference.split('/') {
        if part == "." {
            continue;
        }
        if part == ".." {
            return Err(OfdReaderError::UnsafeResourcePath);
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}

fn archive_contains_resource(entries: &[ZipEntry], path: &str) -> bool {
    entries
        .iter()
        .any(|entry| entry.name == path || entry.name.starts_with(&format!("{path}/")))
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

#[derive(Default, Clone)]
pub struct OfdReadRegistry(Arc<Mutex<RegistryState>>);

#[derive(Default)]
struct RegistryState {
    active: HashMap<String, Arc<AtomicBool>>,
    early_cancelled: HashSet<String>,
    early_order: VecDeque<String>,
}

impl OfdReadRegistry {
    pub fn start(&self, request_id: String) -> Result<Arc<AtomicBool>, OfdReaderError> {
        if request_id.is_empty() || request_id.len() > 128 {
            return Err(OfdReaderError::InvalidRequestId);
        }
        let mut state = self
            .0
            .lock()
            .map_err(|_| OfdReaderError::RegistryUnavailable)?;
        if state.active.contains_key(&request_id) {
            return Err(OfdReaderError::DuplicateRequestId);
        }
        let cancelled = Arc::new(AtomicBool::new(state.early_cancelled.remove(&request_id)));
        state.early_order.retain(|value| value != &request_id);
        state.active.insert(request_id, Arc::clone(&cancelled));
        Ok(cancelled)
    }

    pub fn cancel(&self, request_id: &str) -> Result<(), OfdReaderError> {
        if request_id.is_empty() || request_id.len() > 128 {
            return Err(OfdReaderError::InvalidRequestId);
        }
        let mut state = self
            .0
            .lock()
            .map_err(|_| OfdReaderError::RegistryUnavailable)?;
        if let Some(flag) = state.active.get(request_id) {
            flag.store(true, Ordering::Release);
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

    pub fn finish(&self, request_id: &str) -> Result<(), OfdReaderError> {
        self.0
            .lock()
            .map_err(|_| OfdReaderError::RegistryUnavailable)?
            .active
            .remove(request_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::atomic::AtomicBool,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn append_u16(out: &mut Vec<u8>, value: u16) {
        out.extend_from_slice(&value.to_le_bytes());
    }
    fn append_u32(out: &mut Vec<u8>, value: u32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn stored_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, contents) in entries {
            let offset = out.len() as u32;
            let name = name.as_bytes();
            let crc = crc32(contents);
            append_u32(&mut out, 0x0403_4b50);
            append_u16(&mut out, 20);
            append_u16(&mut out, 0x0800);
            append_u16(&mut out, 0);
            append_u16(&mut out, 0);
            append_u16(&mut out, 0);
            append_u32(&mut out, crc);
            append_u32(&mut out, contents.len() as u32);
            append_u32(&mut out, contents.len() as u32);
            append_u16(&mut out, name.len() as u16);
            append_u16(&mut out, 0);
            out.extend_from_slice(name);
            out.extend_from_slice(contents);
            append_u32(&mut central, 0x0201_4b50);
            append_u16(&mut central, 20);
            append_u16(&mut central, 20);
            append_u16(&mut central, 0x0800);
            append_u16(&mut central, 0);
            append_u16(&mut central, 0);
            append_u16(&mut central, 0);
            append_u32(&mut central, crc);
            append_u32(&mut central, contents.len() as u32);
            append_u32(&mut central, contents.len() as u32);
            append_u16(&mut central, name.len() as u16);
            append_u16(&mut central, 0);
            append_u16(&mut central, 0);
            append_u16(&mut central, 0);
            append_u16(&mut central, 0);
            append_u32(&mut central, 0);
            append_u32(&mut central, offset);
            central.extend_from_slice(name);
        }
        let central_offset = out.len() as u32;
        out.extend_from_slice(&central);
        append_u32(&mut out, 0x0605_4b50);
        append_u16(&mut out, 0);
        append_u16(&mut out, 0);
        append_u16(&mut out, entries.len() as u16);
        append_u16(&mut out, entries.len() as u16);
        append_u32(&mut out, central.len() as u32);
        append_u32(&mut out, central_offset);
        append_u16(&mut out, 0);
        out
    }

    fn valid_ofd() -> Vec<u8> {
        stored_zip(&[
            ("OFD.xml", b"<OFD><DocBody><DocRoot>Doc_0/Document.xml</DocRoot></DocBody></OFD>"),
            ("Doc_0/Document.xml", b"<Document><Pages><Page BaseLoc=\"Pages/Page_0/Content.xml\"/><Page BaseLoc=\"Pages/Page_1/Content.xml\"/></Pages></Document>"),
            ("Doc_0/Pages/Page_0/Content.xml", b"<Page/>") ,
            ("Doc_0/Pages/Page_1/Content.xml", b"<Page/>") ,
        ])
    }

    #[test]
    fn validates_manifest_page_count_and_signature_metadata() {
        let plain = valid_ofd();
        let inspected = inspect_container(&plain).unwrap();
        assert_eq!(inspected.page_count, 2);
        assert!(inspected.resource_warnings.is_empty());

        let signed = stored_zip(&[
            (
                "OFD.xml",
                b"<OFD><DocBody><DocRoot>Doc/Document.xml</DocRoot></DocBody></OFD>",
            ),
            (
                "Doc/Document.xml",
                b"<Document><Pages><Page/></Pages></Document>",
            ),
            ("Doc/Signs/Signatures.xml", b"<Signatures/>"),
        ]);
        assert!(inspect_container(&signed).unwrap().has_signatures);
    }

    #[test]
    fn collects_declared_fonts_and_required_unicode_characters() {
        let public_resources = parse_xml(
            "<Res><Fonts><Font ID=\"F1\" FontName=\"宋体\" FamilyName=\"宋体\" Charset=\"unicode\" Serif=\"true\" Bold=\"false\" Italic=\"false\" FixedSize=\"false\"/></Fonts></Res>".as_bytes(),
            "PublicRes.xml",
            false,
        )
        .unwrap();
        let page = parse_xml(
            "<Page><TextObject Font=\"F1\"><TextCode>中文𠀀</TextCode></TextObject></Page>"
                .as_bytes(),
            "Content.xml",
            false,
        )
        .unwrap();
        let mut fonts = HashMap::new();
        let mut characters = HashMap::new();
        merge_font_summary(&mut fonts, &mut characters, public_resources);
        merge_font_summary(&mut fonts, &mut characters, page);

        let font = fonts.get("F1").expect("应识别 OFD 字体资源");
        assert_eq!(font.font_name, "宋体");
        assert!(font.serif);
        let mut required = characters["F1"].iter().copied().collect::<Vec<_>>();
        required.sort_unstable();
        assert_eq!(required, vec!['中', '文', '𠀀']);
    }

    #[test]
    fn rejects_traversal_missing_manifest_encryption_and_bad_xml() {
        assert!(matches!(
            inspect_container(b"not zip"),
            Err(OfdReaderError::InvalidContainer)
        ));
        let missing = stored_zip(&[("Doc/Document.xml", b"<Document/>")]);
        assert!(matches!(
            inspect_container(&missing),
            Err(OfdReaderError::MissingManifest)
        ));
        let traversal = stored_zip(&[
            (
                "OFD.xml",
                b"<OFD><DocBody><DocRoot>../Document.xml</DocRoot></DocBody></OFD>",
            ),
            (
                "Document.xml",
                b"<Document><Pages><Page/></Pages></Document>",
            ),
        ]);
        assert!(matches!(
            inspect_container(&traversal),
            Err(OfdReaderError::UnsafeResourcePath)
        ));
        let encrypted = stored_zip(&[
            (
                "OFD.xml",
                b"<OFD><DocBody><DocRoot>Document.xml</DocRoot></DocBody></OFD>",
            ),
            (
                "Document.xml",
                b"<Document><Pages><Page/></Pages></Document>",
            ),
            ("Doc/Encryptions.xml", b"<Encryptions/>"),
        ]);
        assert!(matches!(
            inspect_container(&encrypted),
            Err(OfdReaderError::Encrypted)
        ));
        let bad_xml = stored_zip(&[
            ("OFD.xml", b"<OFD><DocRoot>Doc.xml</OFD>"),
            ("Doc.xml", b"<Document><Page/></Document>"),
        ]);
        assert!(matches!(
            inspect_container(&bad_xml),
            Err(OfdReaderError::InvalidXml(_))
        ));
    }

    #[test]
    fn rejects_zip_symlinks_duplicate_entries_and_path_escapes() {
        assert!(validate_zip_path("../outside.png").is_err());
        assert!(validate_zip_path("C:/outside.png").is_err());
        let duplicate = stored_zip(&[
            ("OFD.xml", b"<OFD><DocRoot>Doc.xml</DocRoot></OFD>"),
            ("OFD.xml", b"<OFD><DocRoot>Doc.xml</DocRoot></OFD>"),
        ]);
        assert!(matches!(
            parse_zip_entries(&duplicate),
            Err(OfdReaderError::InvalidContainer)
        ));
    }

    #[test]
    fn reads_valid_local_file_as_binary_and_checks_changes_and_cancel() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("mdstudio-ofd-{unique}.ofd"));
        let bytes = valid_ofd();
        fs::write(&path, &bytes).unwrap();
        let info = inspect_ofd_document(path.to_str().unwrap()).unwrap();
        assert_eq!(info.page_count, 2);
        assert_eq!(
            read_ofd_document(
                path.to_str().unwrap(),
                info.byte_size,
                info.modified_unix_micros,
                &AtomicBool::new(false)
            )
            .unwrap(),
            bytes
        );
        assert!(matches!(
            read_ofd_document(
                path.to_str().unwrap(),
                info.byte_size + 1,
                info.modified_unix_micros,
                &AtomicBool::new(false)
            ),
            Err(OfdReaderError::Changed)
        ));
        assert!(matches!(
            read_ofd_document(
                path.to_str().unwrap(),
                info.byte_size,
                info.modified_unix_micros,
                &AtomicBool::new(true)
            ),
            Err(OfdReaderError::Cancelled)
        ));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn inspects_the_p3_invoice_fixture_without_changing_its_bytes() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../docs/roadmap/multi-format/poc/public/samples/ofdrw-invoice.ofd");
        if !path.is_file() {
            return;
        }
        let before = fs::read(&path).unwrap();
        let info = inspect_ofd_document(path.to_str().unwrap()).unwrap();
        assert_eq!(info.page_count, 1);
        assert!(info.has_signatures);
        assert!(
            info.font_resources
                .iter()
                .any(|font| !font.required_characters.is_empty()),
            "发票应提供字体与实际文本字符用于系统字形匹配"
        );
        assert_eq!(fs::read(&path).unwrap(), before);
    }
}
