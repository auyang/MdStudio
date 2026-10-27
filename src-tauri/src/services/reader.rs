use ammonia::{Builder as HtmlSanitizer, Url, UrlRelative};
use base64::{engine::general_purpose::STANDARD, Engine};
use comrak::{
    adapters::{HeadingAdapter, HeadingMeta},
    format_html_with_plugins,
    nodes::{NodeValue, Sourcepos},
    options::Plugins,
    plugins::syntect::SyntectAdapter,
    Anchorizer, Arena, Options,
};
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Serialize;
#[cfg(feature = "perf-benchmark")]
use std::time::Instant;
use std::{
    collections::{HashMap, HashSet},
    fmt::{self, Write},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
use thiserror::Error;

const MAX_DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_DOCUMENT_IMAGE_BYTES: u64 = 40 * 1024 * 1024;
const MAX_IMAGE_HEADER_BYTES: u64 = 256 * 1024;
const MAX_IMAGE_PIXELS: u64 = 64_000_000;
const HEADING_PREFIX: &str = "mdstudio-";

#[derive(Debug, Error)]
pub enum ReaderError {
    #[error("只支持 .md 和 .markdown 文件：{0}")]
    InvalidPath(String),
    #[error("无法读取文件：{0}")]
    Io(#[from] std::io::Error),
    #[error("文件不是有效的 UTF-8 Markdown：{0}")]
    InvalidUtf8(String),
    #[error("文档超过 64 MiB 阅读上限：{0}")]
    DocumentTooLarge(String),
    #[error("Markdown 渲染失败：{0}")]
    Render(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderHeading {
    pub id: String,
    pub text: String,
    pub level: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderMermaidDiagram {
    pub index: usize,
    pub language: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderImageAsset {
    pub index: usize,
    pub size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct ReaderImageResource {
    pub index: usize,
    pub path: PathBuf,
    pub root: PathBuf,
    pub extension: String,
    pub size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderDocument {
    pub file_path: String,
    pub file_name: String,
    pub html: String,
    pub headings: Vec<ReaderHeading>,
    pub mermaid_diagrams: Vec<ReaderMermaidDiagram>,
    pub image_token: String,
    pub image_assets: Vec<ReaderImageAsset>,
    #[serde(skip)]
    pub image_resources: Vec<ReaderImageResource>,
    pub missing_resources: Vec<String>,
    pub byte_size: u64,
    pub modified_unix_ms: Option<u128>,
    #[cfg(feature = "perf-benchmark")]
    pub performance: ReaderPerformanceTimings,
}

#[cfg(feature = "perf-benchmark")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderPerformanceTimings {
    pub read_ms: f64,
    pub normalize_ms: f64,
    pub parse_ms: f64,
    pub ast_extract_ms: f64,
    pub render_html_ms: f64,
    pub sanitize_ms: f64,
    pub total_ms: f64,
}

pub fn load_document(file_path: &str) -> Result<ReaderDocument, ReaderError> {
    #[cfg(feature = "perf-benchmark")]
    let total_started = Instant::now();
    let requested_path = PathBuf::from(file_path);
    if !is_markdown_path(&requested_path) {
        return Err(ReaderError::InvalidPath(file_path.to_string()));
    }
    let path = requested_path.canonicalize()?;
    let metadata = fs::metadata(&path)?;
    if !metadata.is_file() {
        return Err(ReaderError::InvalidPath(file_path.to_string()));
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(ReaderError::DocumentTooLarge(file_path.to_string()));
    }
    #[cfg(feature = "perf-benchmark")]
    let read_started = Instant::now();
    let bytes = fs::read(&path)?;
    #[cfg(feature = "perf-benchmark")]
    let read_ms = elapsed_ms(read_started);
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(ReaderError::DocumentTooLarge(file_path.to_string()));
    }
    #[cfg(feature = "perf-benchmark")]
    let normalize_started = Instant::now();
    let source_bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    let source = std::str::from_utf8(source_bytes)
        .map_err(|_| ReaderError::InvalidUtf8(file_path.to_string()))?
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    #[cfg(feature = "perf-benchmark")]
    let normalize_ms = elapsed_ms(normalize_started);

    let mut options = Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;
    options.extension.tagfilter = true;
    options.extension.front_matter_delimiter = Some("---".to_string());
    options.extension.header_id_prefix = Some(HEADING_PREFIX.to_string());
    options.extension.header_id_prefix_in_href = true;
    options.render.r#unsafe = false;

    let arena = Arena::new();
    #[cfg(feature = "perf-benchmark")]
    let parse_started = Instant::now();
    let root = comrak::parse_document(&arena, &source, &options);
    #[cfg(feature = "perf-benchmark")]
    let parse_ms = elapsed_ms(parse_started);
    #[cfg(feature = "perf-benchmark")]
    let ast_extract_started = Instant::now();
    let mermaid_diagrams = root
        .descendants()
        .filter_map(|node| {
            let data = node.data.borrow();
            let NodeValue::CodeBlock(block) = &data.value else {
                return None;
            };
            if !block.fenced {
                return None;
            }
            let language = block.info.split_whitespace().next()?;
            language
                .eq_ignore_ascii_case("mermaid")
                .then(|| (language.to_ascii_lowercase(), block.literal.clone()))
        })
        .enumerate()
        .map(|(index, (language, source))| ReaderMermaidDiagram {
            index,
            language,
            source,
        })
        .collect();
    #[cfg(feature = "perf-benchmark")]
    let mermaid_extract_ms = elapsed_ms(ast_extract_started);
    #[cfg(feature = "perf-benchmark")]
    let ast_heading_started = Instant::now();
    let mut anchorizer = FastAnchorizer::default();
    let headings = root
        .descendants()
        .filter_map(|node| {
            let data = node.data.borrow();
            let heading = match &data.value {
                NodeValue::Heading(heading) => heading,
                _ => return None,
            };
            let level = heading.level;
            let text = node.collect_text();
            let slug = anchorizer.anchorize(&text);
            Some(ReaderHeading {
                id: format!("{HEADING_PREFIX}{slug}"),
                text,
                level,
            })
        })
        .collect();
    #[cfg(feature = "perf-benchmark")]
    let ast_extract_ms = mermaid_extract_ms + elapsed_ms(ast_heading_started);

    let syntax_highlighter = syntax_highlighter();
    let heading_adapter = FastHeadingAdapter::default();
    let mut plugins = Plugins::default();
    plugins.render.codefence_syntax_highlighter = Some(syntax_highlighter);
    plugins.render.heading_adapter = Some(&heading_adapter);
    let mut html = String::new();
    #[cfg(feature = "perf-benchmark")]
    let render_html_started = Instant::now();
    format_html_with_plugins(root, &options, &mut html, &plugins)
        .map_err(|error| ReaderError::Render(error.to_string()))?;
    #[cfg(feature = "perf-benchmark")]
    let render_html_ms = elapsed_ms(render_html_started);

    #[cfg(feature = "perf-benchmark")]
    let sanitize_started = Instant::now();
    let missing_resources = Arc::new(Mutex::new(Vec::new()));
    let missing_for_filter = Arc::clone(&missing_resources);
    let image_resources = Arc::new(Mutex::new(Vec::<ReaderImageResource>::new()));
    let image_resources_for_filter = Arc::clone(&image_resources);
    let document_parent = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    let mut sanitizer = HtmlSanitizer::default();
    sanitizer
        .add_generic_attributes(&["id", "class"])
        .add_tags(&["input"])
        .add_tag_attributes("input", &["type", "checked", "disabled"])
        .add_tag_attribute_values("input", "type", &["checkbox"])
        .url_schemes(
            [
                "https",
                "mdstudio-document",
                "mdstudio-missing-image",
                "mdstudio-image",
            ]
            .into(),
        )
        .url_relative(UrlRelative::PassThrough)
        .attribute_filter(
            move |element, attribute, value| match (element, attribute) {
                ("a", "href") => {
                    if value.starts_with('#') {
                        return Some(value.into());
                    }
                    if is_safe_https_url(value) {
                        return Some(value.into());
                    }
                    match resolve_document_link(&document_parent, value) {
                        Some(url) => Some(url.into()),
                        None => None,
                    }
                }
                ("img", "src") => {
                    if let Some(data_url) = resolve_image(
                        &document_parent,
                        value,
                        &missing_for_filter,
                        &image_resources_for_filter,
                    ) {
                        Some(data_url.into())
                    } else {
                        None
                    }
                }
                ("input", "type") if value == "checkbox" => Some(value.into()),
                ("input", "checked" | "disabled") => Some(value.into()),
                (_, "href" | "src") => None,
                _ => Some(value.into()),
            },
        );
    for tag in ["h1", "h2", "h3", "h4", "h5", "h6"] {
        sanitizer.add_tag_attributes(tag, &["aria-label", "data-heading-content"]);
    }
    let html = sanitizer.clean(&html).to_string();
    #[cfg(feature = "perf-benchmark")]
    let sanitize_ms = elapsed_ms(sanitize_started);
    let missing_resources = missing_resources
        .lock()
        .map(|resources| resources.clone())
        .unwrap_or_default();
    let image_resources = image_resources
        .lock()
        .map(|assets| assets.clone())
        .unwrap_or_default();
    let image_assets = image_resources
        .iter()
        .map(|asset| ReaderImageAsset {
            index: asset.index,
            size: asset.size,
            width: asset.width,
            height: asset.height,
        })
        .collect();
    let modified_unix_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis());
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Markdown 文档")
        .to_string();

    Ok(ReaderDocument {
        file_path: path.to_string_lossy().into_owned(),
        file_name,
        html,
        headings,
        mermaid_diagrams,
        image_token: String::new(),
        image_assets,
        image_resources,
        missing_resources,
        byte_size: bytes.len() as u64,
        modified_unix_ms,
        #[cfg(feature = "perf-benchmark")]
        performance: ReaderPerformanceTimings {
            read_ms,
            normalize_ms,
            parse_ms,
            ast_extract_ms,
            render_html_ms,
            sanitize_ms,
            total_ms: elapsed_ms(total_started),
        },
    })
}

#[cfg(feature = "perf-benchmark")]
fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

fn syntax_highlighter() -> &'static SyntectAdapter {
    static HIGHLIGHTER: OnceLock<SyntectAdapter> = OnceLock::new();
    HIGHLIGHTER.get_or_init(|| SyntectAdapter::new(None))
}

/// Comrak 默认标题去重对重复标题逐个检查已用后缀，重复 N 次会退化为 O(N²)。
/// 此实现缓存原始标题的规范 slug，并为每个 slug 保存下一后缀，保持 Comrak 的 ID 规则。
#[derive(Default)]
struct FastAnchorizer {
    base_ids: HashMap<String, String>,
    used_ids: HashSet<String>,
    next_suffix: HashMap<String, usize>,
}

impl FastAnchorizer {
    fn anchorize(&mut self, heading: &str) -> String {
        let base = self
            .base_ids
            .entry(heading.to_owned())
            .or_insert_with(|| Anchorizer::new().anchorize(heading))
            .clone();

        if self.used_ids.insert(base.clone()) {
            self.next_suffix.entry(base.clone()).or_insert(1);
            return base;
        }

        let next_suffix = self.next_suffix.entry(base.clone()).or_insert(1);
        loop {
            let anchor = format!("{base}-{next_suffix}");
            *next_suffix += 1;
            if self.used_ids.insert(anchor.clone()) {
                return anchor;
            }
        }
    }
}

#[derive(Default)]
struct FastHeadingAdapter {
    state: Mutex<FastHeadingState>,
}

#[derive(Default)]
struct FastHeadingState {
    anchorizer: FastAnchorizer,
    active_ids: Vec<String>,
}

impl HeadingAdapter for FastHeadingAdapter {
    fn enter(
        &self,
        output: &mut dyn Write,
        heading: &HeadingMeta,
        _sourcepos: Option<Sourcepos>,
    ) -> fmt::Result {
        let slug = {
            let mut state = self.state.lock().map_err(|_| fmt::Error)?;
            let slug = state.anchorizer.anchorize(&heading.content);
            state.active_ids.push(slug.clone());
            slug
        };
        write!(output, "<h{} id=\"{HEADING_PREFIX}", heading.level)?;
        write_attribute(output, &slug)?;
        output.write_str("\">")
    }

    fn exit(&self, output: &mut dyn Write, heading: &HeadingMeta) -> fmt::Result {
        let slug = self
            .state
            .lock()
            .map_err(|_| fmt::Error)?
            .active_ids
            .pop()
            .ok_or(fmt::Error)?;
        write!(output, "<a href=\"#{HEADING_PREFIX}")?;
        write_attribute(output, &slug)?;
        output.write_str("\" aria-label=\"Link to heading '")?;
        write_attribute(output, &heading.content)?;
        output.write_str("'\" data-heading-content=\"")?;
        write_attribute(output, &heading.content)?;
        output.write_str("\" class=\"anchor\"></a>")?;
        writeln!(output, "</h{}>", heading.level)
    }
}

fn write_attribute(output: &mut dyn Write, value: &str) -> fmt::Result {
    for character in value.chars() {
        match character {
            '&' => output.write_str("&amp;")?,
            '<' => output.write_str("&lt;")?,
            '>' => output.write_str("&gt;")?,
            '"' => output.write_str("&quot;")?,
            '\'' => output.write_str("&#x27;")?,
            _ => output.write_char(character)?,
        }
    }
    Ok(())
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown")
        })
}

/// 返回稳定的文档身份路径。已存在的文件使用真实 canonical 路径；
/// 刚被删除但父目录仍存在的文件保留规范化父目录，以便显示可重试的标签。
pub fn normalize_markdown_path(file_path: &str) -> Result<String, ReaderError> {
    let requested = PathBuf::from(file_path);
    if !is_markdown_path(&requested) {
        return Err(ReaderError::InvalidPath(file_path.to_string()));
    }

    let normalized = match requested.canonicalize() {
        Ok(path) => {
            if !fs::metadata(&path)?.is_file() {
                return Err(ReaderError::InvalidPath(file_path.to_string()));
            }
            path
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let name = requested
                .file_name()
                .ok_or_else(|| ReaderError::InvalidPath(file_path.to_string()))?;
            let parent = requested
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."));
            let parent = parent.canonicalize()?;
            if !parent.is_dir() {
                return Err(ReaderError::InvalidPath(file_path.to_string()));
            }
            parent.join(name)
        }
        Err(error) => return Err(ReaderError::Io(error)),
    };
    Ok(normalized.to_string_lossy().into_owned())
}

fn is_safe_https_url(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
    })
}

fn split_reference(value: &str) -> Option<(String, Option<String>)> {
    let (path, fragment) = value.split_once('#').unwrap_or((value, ""));
    if path.contains('?') || path.contains('\0') {
        return None;
    }
    let path = percent_decode_str(path).decode_utf8().ok()?.into_owned();
    let fragment = (!fragment.is_empty())
        .then(|| {
            percent_decode_str(fragment)
                .decode_utf8()
                .ok()
                .map(|value| value.into_owned())
        })
        .flatten();
    Some((path, fragment))
}

fn canonical_relative_file(parent: &Path, relative_path: &str) -> Option<PathBuf> {
    if relative_path.is_empty()
        || relative_path.starts_with('/')
        || relative_path.starts_with('\\')
        || relative_path.contains(':')
        || relative_path.contains('\0')
    {
        return None;
    }
    let requested = Path::new(relative_path);
    if requested.is_absolute() {
        return None;
    }
    let canonical_parent = parent.canonicalize().ok()?;
    let target = canonical_parent.join(requested).canonicalize().ok()?;
    (target.starts_with(canonical_parent) && target.is_file()).then_some(target)
}

fn resolve_document_link(parent: &Path, value: &str) -> Option<String> {
    let (relative_path, fragment) = split_reference(value)?;
    if relative_path.is_empty() {
        return None;
    }
    let path = canonical_relative_file(parent, &relative_path)?;
    if !is_markdown_path(&path) {
        return None;
    }
    let path_string = path.to_string_lossy();
    let encoded_path = utf8_percent_encode(&path_string, NON_ALPHANUMERIC);
    let mut href = format!("mdstudio-document://open?path={encoded_path}");
    if let Some(fragment) = fragment {
        href.push('#');
        href.push_str(&utf8_percent_encode(&fragment, NON_ALPHANUMERIC).to_string());
    }
    Some(href)
}

fn resolve_image(
    parent: &Path,
    value: &str,
    warnings: &Mutex<Vec<String>>,
    image_resources: &Mutex<Vec<ReaderImageResource>>,
) -> Option<String> {
    let result = (|| {
        if value.starts_with("https:") || value.starts_with("http:") {
            return Err("外部图片已阻止".to_string());
        }
        let (relative_path, _) =
            split_reference(value).ok_or_else(|| "图片路径无效".to_string())?;
        let path = canonical_relative_file(parent, &relative_path)
            .ok_or_else(|| "图片不存在或超出文档目录".to_string())?;
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if image_mime(&extension).is_none() {
            return Err("图片格式不受支持".to_string());
        }
        let metadata = fs::metadata(&path).map_err(|_| "图片不存在".to_string())?;
        if metadata.len() > MAX_IMAGE_BYTES {
            return Err("图片超过 20 MiB 阅读上限".to_string());
        }
        let file = fs::File::open(&path).map_err(|_| "图片无法读取".to_string())?;
        let mut header = Vec::new();
        file.take(MAX_IMAGE_HEADER_BYTES)
            .read_to_end(&mut header)
            .map_err(|_| "图片无法读取".to_string())?;
        if !matches_image_signature(&extension, &header) {
            return Err("图片内容与文件类型不匹配".to_string());
        }
        let (width, height) = image_dimensions(&extension, &header);
        let (width, height) = width
            .zip(height)
            .ok_or_else(|| "无法验证图片尺寸或文件头已损坏".to_string())?;
        if u64::from(width).saturating_mul(u64::from(height)) > MAX_IMAGE_PIXELS {
            return Err("图片像素总量超过 6400 万，已阻止超量解码".to_string());
        }
        let mut resources = image_resources
            .lock()
            .map_err(|_| "图片资源状态不可用".to_string())?;
        if let Some(existing) = resources.iter().find(|asset| asset.path == path) {
            return Ok(format!("mdstudio-image://asset/{}", existing.index));
        }
        let used = resources.iter().map(|asset| asset.size).sum::<u64>();
        if used.saturating_add(metadata.len()) > MAX_DOCUMENT_IMAGE_BYTES {
            return Err("本文图片总量超过 40 MiB 阅读上限".to_string());
        }
        let index = resources.len();
        resources.push(ReaderImageResource {
            index,
            root: parent
                .canonicalize()
                .map_err(|_| "图片所在文档目录无法验证".to_string())?,
            path,
            extension,
            size: metadata.len(),
            width: Some(width),
            height: Some(height),
        });
        Ok(format!("mdstudio-image://asset/{index}"))
    })();

    match result {
        Ok(data_url) => Some(data_url),
        Err(reason) => {
            let decoded = percent_decode_str(value).decode_utf8_lossy();
            let label = Path::new(decoded.as_ref())
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("图片资源");
            let warning = format!("{label}：{reason}");
            if let Ok(mut warnings) = warnings.lock() {
                if !warnings.contains(&warning) {
                    warnings.push(warning);
                }
            }
            None
        }
    }
}

pub fn load_image_asset(resource: &ReaderImageResource) -> Result<String, String> {
    let path = resource
        .path
        .canonicalize()
        .map_err(|_| "图片不存在或已移动".to_string())?;
    let root = resource
        .root
        .canonicalize()
        .map_err(|_| "文档资源目录无法验证".to_string())?;
    if path != resource.path || !path.starts_with(root) || !path.is_file() {
        return Err("图片资源路径已改变或超出文档目录".to_string());
    }
    let metadata = fs::metadata(&path).map_err(|_| "图片无法读取".to_string())?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("图片超过 20 MiB 阅读上限".to_string());
    }
    if metadata.len() != resource.size {
        return Err("图片在打开后发生变化，请刷新文档后重试。".to_string());
    }
    let file = fs::File::open(&path).map_err(|_| "图片无法读取".to_string())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "图片无法读取".to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("图片超过 20 MiB 阅读上限".to_string());
    }
    if !matches_image_signature(&resource.extension, &bytes) {
        return Err("图片内容与文件类型不匹配".to_string());
    }
    let (width, height) = image_dimensions(&resource.extension, &bytes);
    let (width, height) = width
        .zip(height)
        .ok_or_else(|| "无法验证图片尺寸或文件头已损坏".to_string())?;
    if u64::from(width).saturating_mul(u64::from(height)) > MAX_IMAGE_PIXELS {
        return Err("图片像素总量超过 6400 万，已阻止超量解码".to_string());
    }
    let mime = image_mime(&resource.extension).ok_or_else(|| "图片格式不受支持".to_string())?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn image_mime(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

fn image_dimensions(extension: &str, bytes: &[u8]) -> (Option<u32>, Option<u32>) {
    let dimensions = match extension {
        "png" if bytes.len() >= 24 => bytes[16..24].try_into().ok().map(|dimensions: [u8; 8]| {
            (
                u32::from_be_bytes([dimensions[0], dimensions[1], dimensions[2], dimensions[3]]),
                u32::from_be_bytes([dimensions[4], dimensions[5], dimensions[6], dimensions[7]]),
            )
        }),
        "gif" if bytes.len() >= 10 => Some((
            u32::from(u16::from_le_bytes([bytes[6], bytes[7]])),
            u32::from(u16::from_le_bytes([bytes[8], bytes[9]])),
        )),
        "webp" => webp_dimensions(bytes),
        "avif" => avif_dimensions(bytes),
        "jpg" | "jpeg" => jpeg_dimensions(bytes),
        _ => None,
    };
    dimensions
        .filter(|(width, height)| *width > 0 && *height > 0)
        .map_or((None, None), |(width, height)| (Some(width), Some(height)))
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 25 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8X" if bytes.len() >= 30 => Some((
            1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]),
            1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]),
        )),
        b"VP8 " if bytes.len() >= 30 && bytes[23..26] == [0x9d, 0x01, 0x2a] => Some((
            u32::from(u16::from_le_bytes([bytes[26], bytes[27]]) & 0x3fff),
            u32::from(u16::from_le_bytes([bytes[28], bytes[29]]) & 0x3fff),
        )),
        b"VP8L" if bytes.len() >= 25 && bytes[20] == 0x2f => {
            let width = 1 + u32::from(bytes[21]) + (u32::from(bytes[22] & 0x3f) << 8);
            let height = 1
                + u32::from(bytes[22] >> 6)
                + (u32::from(bytes[23]) << 2)
                + (u32::from(bytes[24] & 0x0f) << 10);
            Some((width, height))
        }
        _ => None,
    }
}

fn avif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 16 || !bytes[4..8].eq(b"ftyp") || !bytes[8..12].starts_with(b"avi") {
        return None;
    }
    let mut largest = None;
    for offset in bytes
        .windows(4)
        .enumerate()
        .filter_map(|(index, chunk)| (chunk == b"ispe").then_some(index))
    {
        let Some(width) = bytes
            .get(offset + 8..offset + 12)
            .and_then(|value| value.try_into().ok())
            .map(u32::from_be_bytes)
        else {
            continue;
        };
        let Some(height) = bytes
            .get(offset + 12..offset + 16)
            .and_then(|value| value.try_into().ok())
            .map(u32::from_be_bytes)
        else {
            continue;
        };
        if width == 0 || height == 0 {
            continue;
        }
        if largest.is_none_or(|(current_width, current_height)| {
            u64::from(width) * u64::from(height)
                > u64::from(current_width) * u64::from(current_height)
        }) {
            largest = Some((width, height));
        }
    }
    largest
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut cursor = 2;
    while cursor + 4 <= bytes.len() {
        if bytes[cursor] != 0xff {
            cursor += 1;
            continue;
        }
        while bytes.get(cursor) == Some(&0xff) {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        if marker == 0xd9 || marker == 0xda {
            return None;
        }
        if marker == 0xd8 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let length = usize::from(u16::from_be_bytes([
            *bytes.get(cursor)?,
            *bytes.get(cursor + 1)?,
        ]));
        if length < 2 || cursor + length > bytes.len() {
            return None;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            let height = u32::from(u16::from_be_bytes([
                *bytes.get(cursor + 3)?,
                *bytes.get(cursor + 4)?,
            ]));
            let width = u32::from(u16::from_be_bytes([
                *bytes.get(cursor + 5)?,
                *bytes.get(cursor + 6)?,
            ]));
            return Some((width, height));
        }
        cursor += length;
    }
    None
}

fn matches_image_signature(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "avif" => bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && bytes[8..12].starts_with(b"avi"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/reader-mvp")
            .join(name)
    }

    fn mermaid_fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/mermaid")
            .join(name)
    }

    fn project_fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests")
            .join(name)
    }

    fn media_fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/media-viewer")
            .join(name)
    }

    fn first_mermaid_source(markdown: &str) -> Option<&str> {
        let start = markdown.find("```mermaid\n")? + "```mermaid\n".len();
        let close = markdown[start..].find("\n```")? + start;
        Some(&markdown[start..=close])
    }

    #[test]
    fn fast_anchorizer_matches_comrak_for_duplicate_and_colliding_slugs() {
        let headings = [
            "重复标题",
            "重复标题",
            "重复标题",
            "重复标题-1",
            "重复标题",
            "重复标题-1",
            "A heading",
            "A heading-1",
            "A heading",
        ];
        let mut expected = Anchorizer::new();
        let mut actual = FastAnchorizer::default();
        for heading in headings {
            assert_eq!(actual.anchorize(heading), expected.anchorize(heading));
        }
    }

    #[test]
    fn fast_anchorizer_allocates_many_duplicate_headings_linearly() {
        let mut anchorizer = FastAnchorizer::default();
        let mut last_id = String::new();
        for _ in 0..20_000 {
            last_id = anchorizer.anchorize("重复标题");
        }
        assert_eq!(last_id, "重复标题-19999");
        assert_eq!(anchorizer.used_ids.len(), 20_000);
    }

    #[test]
    fn heading_adapter_escapes_untrusted_attribute_text() {
        let adapter = FastHeadingAdapter::default();
        let heading = HeadingMeta {
            level: 1,
            content: "标题\" onmouseover=\"alert(1)".to_string(),
        };
        let mut html = String::new();
        adapter.enter(&mut html, &heading, None).unwrap();
        adapter.exit(&mut html, &heading).unwrap();
        assert!(html.contains("&quot;"));
        assert!(!html.contains(" onmouseover=\""));
    }

    #[test]
    fn renders_gfm_tables_task_lists_and_strikethrough() {
        let document = load_document(fixture("gfm-tables.md").to_str().unwrap()).unwrap();
        assert!(document.html.contains("<table>"));
        assert!(document.html.contains("type=\"checkbox\""));
        assert!(document.html.contains("<del>"));
    }

    #[test]
    fn code_blocks_are_highlighted_and_keep_language_classes() {
        let document = load_document(fixture("code-blocks.md").to_str().unwrap()).unwrap();
        assert!(document.html.contains("language-rust"));
        assert!(document.html.contains("class=\""));
    }

    #[test]
    fn mermaid_fixtures_keep_ast_language_source_and_html_marker() {
        let cases = [
            ("test-a-english.md", "A[Start] --> B[End]"),
            ("test-b-chinese.md", "A[开始] --> B[结束]"),
            ("test-c-branches.md", "B -->|否| D[重试]"),
            ("test-d-styles.md", "style A fill:#e1f5fe"),
            ("meeting-flow.md", "style S fill:#f3e5f5"),
        ];

        for (name, expected_source) in cases {
            let document = load_document(mermaid_fixture(name).to_str().unwrap()).unwrap();
            assert_eq!(document.mermaid_diagrams.len(), 1, "{name}");
            let diagram = &document.mermaid_diagrams[0];
            assert_eq!(diagram.index, 0, "{name}");
            assert_eq!(diagram.language, "mermaid", "{name}");
            assert!(diagram.source.contains(expected_source), "{name}");
            assert!(document.html.contains("language-mermaid"), "{name}");
        }
    }

    #[test]
    fn multiple_mermaid_fences_keep_order_and_independent_sources() {
        let document =
            load_document(mermaid_fixture("test-h-multiple.md").to_str().unwrap()).unwrap();
        assert_eq!(document.mermaid_diagrams.len(), 2);
        assert_eq!(document.mermaid_diagrams[0].index, 0);
        assert_eq!(document.mermaid_diagrams[0].language, "mermaid");
        assert!(document.mermaid_diagrams[0].source.contains("A[第一张图]"));
        assert_eq!(document.mermaid_diagrams[1].index, 1);
        assert_eq!(document.mermaid_diagrams[1].language, "mermaid");
        assert!(document.mermaid_diagrams[1].source.contains("D[同时显示]"));
        assert_eq!(document.html.matches("language-mermaid").count(), 2);
    }

    #[test]
    fn meeting_flow_fixture_is_an_unmodified_copy_of_the_existing_document_block() {
        let original_path = project_fixture("09-会智通业务流程图.md");
        let original_bytes = fs::read(&original_path).unwrap();
        let original = std::str::from_utf8(&original_bytes).unwrap();
        let fixture_path = mermaid_fixture("meeting-flow.md");
        let fixture_markdown = fs::read_to_string(&fixture_path).unwrap();
        let expected_source = first_mermaid_source(original).unwrap();
        let fixture_source = first_mermaid_source(&fixture_markdown).unwrap();
        assert_eq!(fixture_source, expected_source);

        let document = load_document(fixture_path.to_str().unwrap()).unwrap();
        assert_eq!(document.mermaid_diagrams.len(), 1);
        assert_eq!(document.mermaid_diagrams[0].source, expected_source);
        assert_eq!(fs::read(original_path).unwrap(), original_bytes);
    }

    #[test]
    fn front_matter_is_not_rendered_as_body_text_and_heading_ids_match_toc() {
        let document = load_document(fixture("chinese-content.md").to_str().unwrap()).unwrap();
        assert!(!document.html.contains("published:"));
        assert!(document.html.contains("id=\"mdstudio-中文标题\""));
        assert_eq!(document.headings.first().unwrap().id, "mdstudio-中文标题");
    }

    #[test]
    fn navigation_fixture_preserves_heading_levels_duplicates_and_inline_formatting() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/navigation/heading-levels.md");
        let document = load_document(path.to_str().unwrap()).unwrap();

        assert_eq!(
            document
                .headings
                .iter()
                .map(|heading| heading.level)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5, 6]
        );
        let ids = document
            .headings
            .iter()
            .map(|heading| heading.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(ids.len(), document.headings.len());
        assert!(document.html.contains("行内代码"));
        assert!(document.html.contains("href=\"https://example.org\""));
        for heading in &document.headings {
            assert!(document.html.contains(&format!("id=\"{}\"", heading.id)));
            assert!(document.html.contains(&format!("href=\"#{}\"", heading.id)));
        }
    }

    #[test]
    fn relative_images_and_links_resolve_without_network_access() {
        let document = load_document(fixture("relative-images.md").to_str().unwrap()).unwrap();
        assert!(document.html.contains("mdstudio-image://asset/"));
        assert_eq!(document.image_assets.len(), 1);
        assert!(document.image_assets[0].width.is_some());
        assert!(document.image_assets[0].height.is_some());
        assert!(!document.html.contains("data:image/png;base64,"));
        assert!(!document.html.contains(
            &document.image_resources[0]
                .path
                .to_string_lossy()
                .to_string()
        ));
        assert!(document.html.contains("mdstudio-missing-image") == false);
        assert!(!document.html.contains("https://example.com/image.png"));
        assert!(
            document
                .missing_resources
                .iter()
                .any(|value| value.contains("缺失")),
            "缺失资源清单：{:?}",
            document.missing_resources
        );

        let links = load_document(fixture("relative-links.md").to_str().unwrap()).unwrap();
        assert!(links.html.contains("mdstudio-document://open?path="));
        assert!(links.html.contains("https://example.org/guide"));
        assert!(!links.html.contains("javascript:"));
    }

    #[test]
    fn dangerous_html_and_urls_are_not_executable() {
        let document = load_document(fixture("untrusted-html.md").to_str().unwrap()).unwrap();
        assert!(!document.html.contains("<script"));
        assert!(!document.html.contains("onerror="));
        assert!(!document.html.contains("javascript:"));
    }

    #[test]
    fn reader_does_not_modify_the_markdown_file() {
        let path = fixture("basic.md");
        let before = blake3::hash(&fs::read(&path).unwrap());
        let _ = load_document(path.to_str().unwrap()).unwrap();
        let after = blake3::hash(&fs::read(&path).unwrap());
        assert_eq!(before, after);
    }

    #[test]
    fn one_megabyte_fixture_finishes_within_reasonable_time() {
        let started = Instant::now();
        let document = load_document(fixture("long-document.md").to_str().unwrap()).unwrap();
        assert!(document.byte_size >= 1024 * 1024);
        assert!(started.elapsed().as_secs() < 10);
        println!(
            "长文档解析：{} B，{:.2} ms",
            document.byte_size,
            started.elapsed().as_secs_f64() * 1000.0
        );
    }

    #[test]
    fn rejects_non_markdown_and_invalid_utf8_paths() {
        assert!(load_document(fixture("basic.txt").to_str().unwrap()).is_err());
        let invalid_path =
            std::env::temp_dir().join(format!("mdstudio-reader-invalid-{}.md", std::process::id()));
        fs::write(&invalid_path, [0xff, 0xfe, 0x00]).unwrap();
        let result = load_document(invalid_path.to_str().unwrap());
        let _ = fs::remove_file(&invalid_path);
        assert!(matches!(result, Err(ReaderError::InvalidUtf8(_))));
    }

    #[test]
    fn normalizes_existing_and_missing_markdown_paths_without_accepting_other_types() {
        let existing = fixture("basic.md");
        let canonical = existing.canonicalize().unwrap();
        assert_eq!(
            normalize_markdown_path(existing.to_str().unwrap()).unwrap(),
            canonical.to_string_lossy()
        );

        let missing = fixture("下一个 文档.md");
        let expected = missing
            .parent()
            .unwrap()
            .canonicalize()
            .unwrap()
            .join("下一个 文档.md");
        assert_eq!(
            normalize_markdown_path(missing.to_str().unwrap()).unwrap(),
            expected.to_string_lossy()
        );
        assert!(normalize_markdown_path("not-markdown.txt").is_err());
    }

    #[test]
    fn unsafe_relative_paths_are_rejected() {
        let parent = fixture("relative-images.md")
            .parent()
            .unwrap()
            .to_path_buf();
        assert!(canonical_relative_file(&parent, "../secret.png").is_none());
        assert!(canonical_relative_file(&parent, "/etc/passwd").is_none());
    }

    #[test]
    #[cfg(unix)]
    fn symlinks_cannot_escape_the_document_directory() {
        use std::os::unix::fs::symlink;

        let nonce = format!("{}-reader-symlink", std::process::id());
        let root = std::env::temp_dir().join(&nonce);
        let outside = std::env::temp_dir().join(format!("{nonce}-outside.md"));
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, "# 外部文件").unwrap();
        symlink(&outside, root.join("逃逸.md")).unwrap();
        assert!(canonical_relative_file(&root, "逃逸.md").is_none());
        let _ = fs::remove_file(root.join("逃逸.md"));
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir(root);
    }

    #[test]
    fn image_bytes_are_loaded_only_on_demand_and_revalidated() {
        let root = std::env::temp_dir().join(format!("mdstudio-image-lazy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let source_image = fixture("资源/示例 图片.png");
        let image_path = root.join("示例 图片.png");
        fs::copy(&source_image, &image_path).unwrap();
        let markdown_path = root.join("测试.md");
        fs::write(&markdown_path, "# 延迟图片\n\n![图片](<示例 图片.png>)\n").unwrap();
        let document = load_document(markdown_path.to_str().unwrap()).unwrap();
        let resource = document.image_resources.first().unwrap();
        assert!(!document
            .html
            .contains(&resource.path.to_string_lossy().to_string()));
        let loaded = load_image_asset(resource).unwrap();
        assert!(loaded.starts_with("data:image/png;base64,"));

        fs::write(&image_path, b"changed after document open").unwrap();
        let result = load_image_asset(resource);
        assert!(result.is_err());
        drop(document);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn media_viewer_fixture_resolves_encoded_paths_and_preserves_original_hashes() {
        let markdown_path = media_fixture("images-and-paths.md");
        let markdown_before = blake3::hash(&fs::read(&markdown_path).unwrap());
        let special_image = media_fixture("assets/流程 # 50% (会议).png");
        let special_before = blake3::hash(&fs::read(&special_image).unwrap());

        let document = load_document(markdown_path.to_str().unwrap()).unwrap();
        assert_eq!(document.image_assets.len(), 5);
        assert!(document
            .image_resources
            .iter()
            .any(|resource| resource.path == special_image.canonicalize().unwrap()));
        assert!(document.html.contains("mdstudio-image://asset/"));
        assert!(!document.html.contains("data:image/"));
        assert!(!document.html.contains(
            &special_image
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .to_string()
        ));
        assert!(document
            .missing_resources
            .iter()
            .any(|resource| resource.contains("損坏") || resource.contains("损坏")));
        assert!(document
            .missing_resources
            .iter()
            .any(|resource| resource.contains("不存在的图片")));
        assert!(document
            .missing_resources
            .iter()
            .any(|resource| resource.contains("不可信.svg")));
        assert!(!document.html.contains("<script"));
        assert!(!document.html.contains("tracker.png"));
        assert!(document.html.contains("mdstudio-document://open?path="));

        assert_eq!(
            markdown_before,
            blake3::hash(&fs::read(&markdown_path).unwrap())
        );
        assert_eq!(
            special_before,
            blake3::hash(&fs::read(&special_image).unwrap())
        );
    }

    #[test]
    fn rejects_oversized_images_without_reading_their_payload() {
        let root =
            std::env::temp_dir().join(format!("mdstudio-image-limit-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let image_path = root.join("oversized.png");
        let file = fs::File::create(&image_path).unwrap();
        file.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        let markdown_path = root.join("limit.md");
        fs::write(&markdown_path, "![超大图片](oversized.png)\n").unwrap();

        let document = load_document(markdown_path.to_str().unwrap()).unwrap();
        assert!(document.image_assets.is_empty());
        assert!(document
            .missing_resources
            .iter()
            .any(|message| message.contains("20 MiB")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_images_with_excessive_pixel_dimensions() {
        let root =
            std::env::temp_dir().join(format!("mdstudio-pixel-limit-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let image_path = root.join("pixel-bomb.png");
        let mut header = vec![0u8; 24];
        header[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        header[16..20].copy_from_slice(&10_000u32.to_be_bytes());
        header[20..24].copy_from_slice(&10_000u32.to_be_bytes());
        fs::write(&image_path, header).unwrap();
        let markdown_path = root.join("pixel-limit.md");
        fs::write(&markdown_path, "![超高像素图片](pixel-bomb.png)\n").unwrap();

        let document = load_document(markdown_path.to_str().unwrap()).unwrap();
        assert!(document.image_assets.is_empty());
        assert!(document
            .missing_resources
            .iter()
            .any(|message| message.contains("6400 万")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn webp_dimension_parser_covers_lossy_lossless_and_extended_headers() {
        let mut extended = vec![0; 30];
        extended[..4].copy_from_slice(b"RIFF");
        extended[8..12].copy_from_slice(b"WEBP");
        extended[12..16].copy_from_slice(b"VP8X");
        extended[24..27].copy_from_slice(&[0x2f, 0x03, 0x00]);
        extended[27..30].copy_from_slice(&[0x5f, 0x01, 0x00]);
        assert_eq!(webp_dimensions(&extended), Some((816, 352)));

        let mut lossy = vec![0; 30];
        lossy[..4].copy_from_slice(b"RIFF");
        lossy[8..12].copy_from_slice(b"WEBP");
        lossy[12..16].copy_from_slice(b"VP8 ");
        lossy[23..26].copy_from_slice(&[0x9d, 0x01, 0x2a]);
        lossy[26..30].copy_from_slice(&[0x20, 0x03, 0x58, 0x02]);
        assert_eq!(webp_dimensions(&lossy), Some((800, 600)));

        let mut lossless = vec![0; 25];
        lossless[..4].copy_from_slice(b"RIFF");
        lossless[8..12].copy_from_slice(b"WEBP");
        lossless[12..16].copy_from_slice(b"VP8L");
        lossless[20..25].copy_from_slice(&[0x2f, 0x1f, 0x58, 0x95, 0x02]);
        assert!(webp_dimensions(&lossless).is_some_and(|(width, height)| width > 0 && height > 0));
    }
}
