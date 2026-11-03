use fontdb::{Database, Style as FontStyle, ID};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};
use thiserror::Error;

const MAX_SYSTEM_FONT_BYTES: usize = 32 * 1024 * 1024;
const MAX_FONT_BYTES_PER_SESSION: usize = 128 * 1024 * 1024;
const MAX_FONT_BYTES_TOTAL: usize = 256 * 1024 * 1024;
const MAX_FONT_REQUESTS: usize = 64;
const MAX_CHARS_PER_REQUEST: usize = 8_192;
const MAX_FONT_SOURCES_PER_SESSION: usize = 128;
const MAX_FONT_SESSIONS: usize = 64;

#[derive(Debug, Error)]
pub enum SystemFontError {
    #[error("系统字体服务暂不可用")]
    Unavailable,
    #[error("字体请求超出安全限制")]
    Limit,
    #[error("系统字体来源无效或已释放")]
    InvalidSource,
    #[error("字体文件超过 32 MiB 安全上限")]
    TooLarge,
    #[error("系统字体数据无法通过字体面和字形表校验")]
    InvalidFont,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontRequest {
    pub id: String,
    pub font_name: String,
    pub family_name: Option<String>,
    pub charset: String,
    pub serif: bool,
    pub bold: bool,
    pub italic: bool,
    pub fixed_size: bool,
    #[serde(default)]
    pub required_characters: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontSource {
    pub index: usize,
    pub family: String,
    pub post_script_name: String,
    pub covered_characters: usize,
    pub required_characters: usize,
    pub exact_family_match: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontResolution {
    pub session_id: String,
    pub sources: Vec<SystemFontSource>,
    pub aliases: Vec<Vec<String>>,
    pub missing_font_names: Vec<String>,
}

#[derive(Default, Clone)]
pub struct SystemFontService(Arc<Mutex<FontState>>);

#[derive(Default)]
struct FontState {
    database: Option<Database>,
    sessions: HashMap<String, FontSession>,
    bytes_served: usize,
}

#[derive(Clone)]
struct RegisteredFace {
    id: ID,
    byte_size: usize,
}

#[derive(Default)]
struct FontSession {
    faces: Vec<RegisteredFace>,
    bytes_served: usize,
}

#[derive(Clone)]
struct Candidate {
    id: ID,
    byte_size: usize,
    source_key: String,
    family: String,
    post_script_name: String,
    exact_family_match: bool,
    coverage: usize,
    style_score: i32,
}

impl SystemFontService {
    pub fn resolve(
        &self,
        session_id: &str,
        requests: &[FontRequest],
        fallback_preference: &str,
    ) -> Result<SystemFontResolution, SystemFontError> {
        if !valid_session_id(session_id) || requests.len() > MAX_FONT_REQUESTS {
            return Err(SystemFontError::Limit);
        }
        let mut state = self.0.lock().map_err(|_| SystemFontError::Unavailable)?;
        if let Some(previous) = state.sessions.remove(session_id) {
            state.bytes_served = state.bytes_served.saturating_sub(previous.bytes_served);
        }
        if state.sessions.len() >= MAX_FONT_SESSIONS && !state.sessions.contains_key(session_id) {
            return Err(SystemFontError::Limit);
        }
        if state.database.is_none() {
            let mut database = Database::new();
            database.load_system_fonts();
            state.database = Some(database);
        }
        let database = state
            .database
            .as_ref()
            .ok_or(SystemFontError::Unavailable)?;
        let mut registered = Vec::new();
        let mut source_indexes = HashMap::<String, usize>::new();
        let mut sources = Vec::new();
        let mut aliases = Vec::new();
        let mut missing_font_names = Vec::new();
        let mut session_bytes = 0usize;

        for request in requests {
            validate_request(request)?;
            let mut candidates = find_candidates(database, request, fallback_preference)?;
            sort_candidates(&mut candidates);
            let mut seen_sources = HashSet::new();
            candidates.retain(|candidate| seen_sources.insert(candidate.source_key.clone()));

            // 同名字体优先，之后最多再带两个已验证目标字形覆盖的系统 CJK 字体。
            let exact = candidates
                .iter()
                .find(|candidate| candidate.exact_family_match)
                .cloned();
            let mut selected = Vec::new();
            if let Some(candidate) = exact {
                selected.push(candidate);
            }
            for candidate in candidates
                .into_iter()
                .filter(|candidate| !candidate.exact_family_match && candidate.coverage > 0)
            {
                if selected
                    .iter()
                    .any(|item| item.source_key == candidate.source_key)
                {
                    continue;
                }
                selected.push(candidate);
                if selected.len() >= 3 {
                    break;
                }
            }
            if selected.is_empty() {
                missing_font_names.push(request.font_name.clone());
                continue;
            }

            let mut family_aliases = vec![request.font_name.clone()];
            if let Some(family_name) = request
                .family_name
                .as_ref()
                .filter(|name| !name.trim().is_empty())
            {
                family_aliases.push(family_name.clone());
            }
            for candidate in selected {
                let index = if let Some(index) = source_indexes.get(&candidate.source_key) {
                    *index
                } else {
                    if sources.len() >= MAX_FONT_SOURCES_PER_SESSION {
                        return Err(SystemFontError::Limit);
                    }
                    session_bytes = session_bytes
                        .checked_add(candidate.byte_size)
                        .filter(|total| *total <= MAX_FONT_BYTES_PER_SESSION)
                        .ok_or(SystemFontError::Limit)?;
                    let index = sources.len();
                    source_indexes.insert(candidate.source_key.clone(), index);
                    registered.push(RegisteredFace {
                        id: candidate.id,
                        byte_size: candidate.byte_size,
                    });
                    sources.push(SystemFontSource {
                        index,
                        family: candidate.family.clone(),
                        post_script_name: candidate.post_script_name.clone(),
                        covered_characters: candidate.coverage,
                        required_characters: request
                            .required_characters
                            .chars()
                            .collect::<HashSet<_>>()
                            .len(),
                        exact_family_match: candidate.exact_family_match,
                    });
                    index
                };
                let mut alias_group = family_aliases.clone();
                alias_group.push(candidate.family.clone());
                alias_group.push(candidate.post_script_name.clone());
                aliases.push(alias_group);
                let _ = index;
            }
        }

        state.sessions.insert(
            session_id.to_string(),
            FontSession {
                faces: registered,
                bytes_served: 0,
            },
        );
        Ok(SystemFontResolution {
            session_id: session_id.to_string(),
            sources,
            aliases,
            missing_font_names,
        })
    }

    pub fn read_source(&self, session_id: &str, index: usize) -> Result<Vec<u8>, SystemFontError> {
        if !valid_session_id(session_id) {
            return Err(SystemFontError::InvalidSource);
        }
        let mut state = self.0.lock().map_err(|_| SystemFontError::Unavailable)?;
        let registered = state
            .sessions
            .get(session_id)
            .and_then(|session| session.faces.get(index))
            .cloned()
            .ok_or(SystemFontError::InvalidSource)?;
        if registered.byte_size > MAX_FONT_BYTES_PER_SESSION
            || state.sessions.get(session_id).is_some_and(|session| {
                session.bytes_served.saturating_add(registered.byte_size)
                    > MAX_FONT_BYTES_PER_SESSION
            })
            || state.bytes_served.saturating_add(registered.byte_size) > MAX_FONT_BYTES_TOTAL
        {
            return Err(SystemFontError::Limit);
        }
        let database = state
            .database
            .as_ref()
            .ok_or(SystemFontError::InvalidSource)?;
        let bytes = database
            .with_face_data(registered.id, |data, face_index| {
                // 校验 fontdb 选出的 TTC/OTF/TTF 面索引后再把集合原始字节交给 OFDRW。
                validate_font_face(data, face_index)?;
                Ok(data.to_vec())
            })
            .ok_or(SystemFontError::InvalidFont)??;
        let session = state
            .sessions
            .get_mut(session_id)
            .ok_or(SystemFontError::InvalidSource)?;
        session.bytes_served = session.bytes_served.saturating_add(bytes.len());
        state.bytes_served = state.bytes_served.saturating_add(bytes.len());
        Ok(bytes)
    }

    pub fn release(&self, session_id: &str) -> Result<(), SystemFontError> {
        if !valid_session_id(session_id) {
            return Err(SystemFontError::InvalidSource);
        }
        let mut state = self.0.lock().map_err(|_| SystemFontError::Unavailable)?;
        if let Some(session) = state.sessions.remove(session_id) {
            state.bytes_served = state.bytes_served.saturating_sub(session.bytes_served);
        }
        Ok(())
    }
}

fn valid_session_id(session_id: &str) -> bool {
    session_id.len() == 36
        && session_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

fn validate_request(request: &FontRequest) -> Result<(), SystemFontError> {
    if request.id.len() > 32
        || request.font_name.trim().is_empty()
        || request.font_name.len() > 256
        || request
            .family_name
            .as_ref()
            .is_some_and(|name| name.len() > 256)
        || request.required_characters.chars().count() > MAX_CHARS_PER_REQUEST
        || request.charset.len() > 32
    {
        return Err(SystemFontError::Limit);
    }
    Ok(())
}

fn validate_font_face(
    data: &[u8],
    face_index: u32,
) -> Result<ttf_parser::Face<'_>, SystemFontError> {
    if data.len() > MAX_SYSTEM_FONT_BYTES {
        return Err(SystemFontError::TooLarge);
    }
    ttf_parser::Face::parse(data, face_index).map_err(|_| SystemFontError::InvalidFont)
}

fn sort_candidates(candidates: &mut [Candidate]) {
    candidates.sort_by(|left, right| {
        right
            .exact_family_match
            .cmp(&left.exact_family_match)
            .then_with(|| right.coverage.cmp(&left.coverage))
            .then_with(|| right.style_score.cmp(&left.style_score))
            .then_with(|| left.family.cmp(&right.family))
    });
}

fn find_candidates(
    database: &Database,
    request: &FontRequest,
    fallback_preference: &str,
) -> Result<Vec<Candidate>, SystemFontError> {
    let names = [
        Some(request.font_name.as_str()),
        request.family_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    let aliases = names
        .iter()
        .filter_map(|name| alias_group(name))
        .flatten()
        .map(|name| normalize(name))
        .collect::<HashSet<_>>();
    let preferred = fallback_names(request, fallback_preference);
    let required = request.required_characters.chars().collect::<HashSet<_>>();
    let mut output = Vec::new();

    for face in database.faces() {
        let family_names = face
            .families
            .iter()
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>();
        let exact = names.iter().any(|name| {
            family_names
                .iter()
                .any(|family| normalize(family) == normalize(name))
        }) || names
            .iter()
            .any(|name| normalize(&face.post_script_name) == normalize(name));
        let alias = !exact
            && family_names
                .iter()
                .any(|family| aliases.contains(&normalize(family)))
            || (!exact && aliases.contains(&normalize(&face.post_script_name)));
        let named_fallback = preferred.iter().any(|name| {
            family_names
                .iter()
                .any(|family| normalize(family) == normalize(name))
                || normalize(&face.post_script_name) == normalize(name)
        });
        if !exact && !alias && !named_fallback {
            continue;
        }
        let source_key = format!("{:?}", face.source);
        let Some((data_len, coverage)) = database
            .with_face_data(face.id, |data, index| {
                let parsed = validate_font_face(data, index).ok()?;
                let covered = required
                    .iter()
                    .filter(|character| parsed.glyph_index(**character).is_some())
                    .count();
                Some((data.len(), covered))
            })
            .flatten()
        else {
            continue;
        };
        let _ = data_len;
        if coverage == 0 && !required.is_empty() && !exact {
            continue;
        }
        let style_score = style_score(face.style, face.weight.0, face.monospaced, request);
        output.push(Candidate {
            id: face.id,
            byte_size: data_len,
            source_key,
            family: face
                .families
                .first()
                .map(|(name, _)| name.clone())
                .unwrap_or_else(|| face.post_script_name.clone()),
            post_script_name: face.post_script_name.clone(),
            // 将原名命中与中文别名区分开，保证原名字体在别名和补充字形字体之前。
            exact_family_match: exact,
            coverage,
            style_score,
        });
    }
    Ok(output)
}

fn style_score(style: FontStyle, weight: u16, monospaced: bool, request: &FontRequest) -> i32 {
    let italic = matches!(style, FontStyle::Italic | FontStyle::Oblique);
    let target_weight = if request.bold { 700i32 } else { 400i32 };
    (if italic == request.italic { 16 } else { 0 })
        + (if request.fixed_size == monospaced {
            8
        } else {
            0
        })
        + (if (weight as i32 - target_weight).abs() <= 100 {
            8
        } else {
            0
        })
}

fn fallback_names(request: &FontRequest, preference: &str) -> Vec<&'static str> {
    let serif = match preference {
        "source-han-sans" => false,
        "source-han-serif" => true,
        _ => request.serif,
    };
    if serif {
        vec![
            "Source Han Serif SC",
            "SourceHanSerifSC",
            "Songti SC",
            "STSong",
            "SimSun",
            "Noto Serif CJK SC",
            "Hiragino Mincho ProN",
        ]
    } else {
        vec![
            "Source Han Sans SC",
            "SourceHanSansSC",
            "PingFang SC",
            "Heiti SC",
            "Hiragino Sans GB",
            "Microsoft YaHei",
            "SimHei",
            "Noto Sans CJK SC",
        ]
    }
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn alias_group(name: &str) -> Option<&'static [&'static str]> {
    const SONG: &[&str] = &[
        "宋体",
        "新宋体",
        "SimSun",
        "NSimSun",
        "Songti SC",
        "Songti TC",
        "STSong",
        "Noto Serif CJK SC",
        "Source Han Serif SC",
        "SourceHanSerifSC",
    ];
    const SANS: &[&str] = &[
        "黑体",
        "SimHei",
        "微软雅黑",
        "Microsoft YaHei",
        "PingFang SC",
        "Heiti SC",
        "STHeiti",
        "Hiragino Sans GB",
        "Noto Sans CJK SC",
        "Source Han Sans SC",
        "SourceHanSansSC",
    ];
    const KAI: &[&str] = &[
        "楷体",
        "楷体_GB2312",
        "KaiTi",
        "KaiTi_GB2312",
        "STKaiti",
        "Kaiti SC",
    ];
    const FANG: &[&str] = &[
        "仿宋",
        "仿宋_GB2312",
        "FangSong",
        "FangSong_GB2312",
        "STFangsong",
    ];
    let normalized = normalize(name);
    [SONG, SANS, KAI, FANG].into_iter().find(|group| {
        group
            .iter()
            .any(|candidate| normalize(candidate) == normalized)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_common_cjk_font_aliases_and_preference() {
        assert!(alias_group("宋体").unwrap().contains(&"SimSun"));
        assert!(alias_group("Microsoft YaHei")
            .unwrap()
            .contains(&"微软雅黑"));
        assert!(alias_group("楷体_GB2312").unwrap().contains(&"STKaiti"));
        assert!(fallback_names(
            &FontRequest {
                id: "1".into(),
                font_name: "未知".into(),
                family_name: None,
                charset: "unicode".into(),
                serif: false,
                bold: false,
                italic: false,
                fixed_size: false,
                required_characters: String::new(),
            },
            "source-han-serif"
        )
        .contains(&"Source Han Serif SC"));
    }

    #[test]
    fn limits_session_names_and_request_sizes() {
        assert!(!valid_session_id("../../Library/Fonts/font.ttf"));
        assert!(valid_session_id("a0b1c2d3-e4f5-6789-abcd-0123456789ab"));
        let mut request = FontRequest {
            id: "1".into(),
            font_name: "Songti SC".into(),
            family_name: None,
            charset: "unicode".into(),
            serif: true,
            bold: false,
            italic: false,
            fixed_size: false,
            required_characters: String::new(),
        };
        request.required_characters = "汉".repeat(MAX_CHARS_PER_REQUEST + 1);
        assert!(matches!(
            validate_request(&request),
            Err(SystemFontError::Limit)
        ));
    }

    #[test]
    fn validates_real_font_glyph_coverage_and_rejects_damaged_data() {
        let latin =
            include_bytes!("../../../public/pdfjs/standard_fonts/LiberationSans-Regular.ttf");
        let face = ttf_parser::Face::parse(latin, 0).unwrap();
        assert!(face.glyph_index('A').is_some());
        assert!(face.glyph_index('汉').is_none());
        assert!(ttf_parser::Face::parse(b"not a font", 0).is_err());
    }

    #[test]
    fn accepts_otf_cff_faces_and_rejects_oversized_font_payloads() {
        let otf = include_bytes!("../../../node_modules/katex/src/fonts/lib/Extra.otf");
        assert!(validate_font_face(otf, 0).is_ok());

        let oversized = vec![0; MAX_SYSTEM_FONT_BYTES + 1];
        assert!(matches!(
            validate_font_face(&oversized, 0),
            Err(SystemFontError::TooLarge)
        ));
    }

    #[test]
    fn exact_system_family_precedes_a_better_covered_chinese_supplement() {
        let candidate = |family: &str, exact_family_match, coverage| Candidate {
            id: ID::dummy(),
            byte_size: 1,
            source_key: family.into(),
            family: family.into(),
            post_script_name: family.into(),
            exact_family_match,
            coverage,
            style_score: 0,
        };
        let mut candidates = vec![
            candidate("PingFang SC", false, 20),
            candidate("KaiTi", true, 2),
        ];
        sort_candidates(&mut candidates);
        assert_eq!(candidates[0].family, "KaiTi");
        assert_eq!(candidates[1].family, "PingFang SC");
    }

    #[test]
    fn releasing_font_sessions_returns_served_bytes_to_the_global_budget() {
        let service = SystemFontService::default();
        let session_id = "a0b1c2d3-e4f5-6789-abcd-0123456789ab";
        {
            let mut state = service.0.lock().unwrap();
            state.bytes_served = 4096;
            state.sessions.insert(
                session_id.to_string(),
                FontSession {
                    faces: Vec::new(),
                    bytes_served: 4096,
                },
            );
        }
        service.release(session_id).unwrap();
        let state = service.0.lock().unwrap();
        assert_eq!(state.bytes_served, 0);
        assert!(!state.sessions.contains_key(session_id));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_system_font_database_exposes_cjk_glyphs_and_valid_collection_faces() {
        let mut database = Database::new();
        database.load_system_fonts();
        let has_cjk_face = database.faces().any(|face| {
            database
                .with_face_data(face.id, |data, face_index| {
                    ttf_parser::Face::parse(data, face_index)
                        .ok()
                        .is_some_and(|parsed| parsed.glyph_index('中').is_some())
                })
                .unwrap_or(false)
        });
        assert!(has_cjk_face, "macOS 系统字体数据库应包含可显示中文的字体面");

        let has_cjk_collection = database.faces().any(|face| {
            format!("{:?}", face.source)
                .to_ascii_lowercase()
                .contains(".ttc")
                && database
                    .with_face_data(face.id, |data, face_index| {
                        ttf_parser::Face::parse(data, face_index)
                            .ok()
                            .is_some_and(|parsed| parsed.glyph_index('中').is_some())
                    })
                    .unwrap_or(false)
        });
        assert!(
            has_cjk_collection,
            "macOS 应能按 fontdb 面索引校验 TTC 中的中文字体面"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn p3_invoice_resolves_cjk_system_font_sources_from_its_ofd_font_declarations() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../docs/roadmap/multi-format/poc/public/samples/ofdrw-invoice.ofd");
        let info = crate::services::ofd_reader::inspect_ofd_document(path.to_str().unwrap())
            .expect("P3 发票 OFD 样本应可读取");
        let requests = info
            .font_resources
            .into_iter()
            .map(|font| FontRequest {
                id: font.id,
                font_name: font.font_name,
                family_name: font.family_name,
                charset: font.charset,
                serif: font.serif,
                bold: font.bold,
                italic: font.italic,
                fixed_size: font.fixed_size,
                required_characters: font.required_characters,
            })
            .collect::<Vec<_>>();
        let session_id = "c0ffee00-0000-4000-8000-000000000001";
        let service = SystemFontService::default();
        let resolution = service
            .resolve(session_id, &requests, "auto")
            .expect("系统字体应能为 OFD 声明执行匹配");

        assert!(!resolution.sources.is_empty(), "应返回系统字体来源");
        assert!(
            resolution
                .sources
                .iter()
                .any(|source| source.covered_characters > 0),
            "至少一个系统字体应覆盖文档所需汉字"
        );
        assert!(
            resolution.missing_font_names.is_empty(),
            "该 macOS 环境应能为发票字体找到替代字体"
        );
        for source in &resolution.sources {
            let bytes = service
                .read_source(session_id, source.index)
                .expect("注册字体源应能按 session+index 读取");
            assert!(!bytes.is_empty());
            assert!(bytes.len() <= MAX_SYSTEM_FONT_BYTES);
        }
        service.release(session_id).unwrap();
    }
}
