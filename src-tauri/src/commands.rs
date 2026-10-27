use crate::services::{
    reader,
    watcher::{FileWatcherService, WatcherStatus},
};
use ammonia::Url;
use std::{collections::VecDeque, path::Path, sync::Mutex};
#[cfg(feature = "perf-benchmark")]
use std::{fs::OpenOptions, io::Write};
#[cfg(feature = "perf-benchmark")]
use std::{sync::OnceLock, time::Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[cfg(feature = "perf-benchmark")]
static APP_STARTED: OnceLock<Instant> = OnceLock::new();

#[cfg(feature = "perf-benchmark")]
pub fn mark_performance_app_started() {
    let _ = APP_STARTED.set(Instant::now());
}

#[derive(Default)]
pub struct ReaderImageRegistry(Mutex<VecDeque<(String, Vec<reader::ReaderImageResource>)>>);

impl ReaderImageRegistry {
    fn register(
        &self,
        token: String,
        resources: Vec<reader::ReaderImageResource>,
    ) -> Result<(), String> {
        let mut documents = self
            .0
            .lock()
            .map_err(|_| "图片资源状态不可用".to_string())?;
        documents.retain(|(existing, _)| existing != &token);
        documents.push_back((token, resources));
        Ok(())
    }

    fn release(&self, token: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "图片资源状态不可用".to_string())?
            .retain(|(existing, _)| existing != token);
        Ok(())
    }

    fn get(&self, token: &str, index: usize) -> Result<reader::ReaderImageResource, String> {
        self.0
            .lock()
            .map_err(|_| "图片资源状态不可用".to_string())?
            .iter()
            .find(|(existing, _)| existing == token)
            .and_then(|(_, resources)| resources.iter().find(|resource| resource.index == index))
            .cloned()
            .ok_or_else(|| "图片资源已过期，请刷新当前文档后重试。".to_string())
    }
}

static NEXT_IMAGE_TOKEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

#[derive(Default)]
pub struct PendingOpenFiles(std::sync::Mutex<Vec<String>>);

impl PendingOpenFiles {
    pub fn new(paths: Vec<String>) -> Self {
        Self(std::sync::Mutex::new(paths))
    }

    pub fn push(&self, path: String) {
        if let Ok(mut paths) = self.0.lock() {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }

    fn take(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut paths| std::mem::take(&mut *paths))
            .unwrap_or_default()
    }
}

#[tauri::command]
pub async fn load_reader_document(
    file_path: String,
    registry: State<'_, ReaderImageRegistry>,
) -> Result<reader::ReaderDocument, String> {
    let mut document =
        tauri::async_runtime::spawn_blocking(move || reader::load_document(&file_path))
            .await
            .map_err(|error| format!("阅读任务失败：{error}"))?
            .map_err(|error| error.to_string())?;

    document.image_token = format!(
        "{}-{}",
        std::process::id(),
        NEXT_IMAGE_TOKEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    registry.register(
        document.image_token.clone(),
        document.image_resources.clone(),
    )?;
    Ok(document)
}

#[cfg(feature = "perf-benchmark")]
#[tauri::command]
pub fn record_performance_sample(sample: String) -> Result<(), String> {
    if sample.len() > 8192 {
        return Err("性能采样记录超过长度限制".into());
    }
    let path = option_env!("MDSTUDIO_PERF_LOG_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("mdstudio-p1-8-perf.jsonl"));
    let mut line = sample.trim().to_string();
    if !line.starts_with('{') || !line.ends_with('}') {
        return Err("性能采样 JSON 结构无效".into());
    }
    if let Some(started) = APP_STARTED.get() {
        line.pop();
        line.push_str(&format!(
            ",\"processElapsedMs\":{:.3}}}",
            started.elapsed().as_secs_f64() * 1000.0
        ));
    }
    line = line.replace('\r', " ").replace('\n', " ");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("无法写入性能采样：{error}"))?;
    writeln!(file, "{line}").map_err(|error| format!("无法写入性能采样：{error}"))
}

#[tauri::command]
pub async fn load_reader_image(
    image_token: String,
    index: usize,
    registry: State<'_, ReaderImageRegistry>,
) -> Result<String, String> {
    let resource = registry.get(&image_token, index)?;
    tauri::async_runtime::spawn_blocking(move || reader::load_image_asset(&resource))
        .await
        .map_err(|error| format!("图片读取任务失败：{error}"))?
}

#[tauri::command]
pub fn release_reader_image_document(
    image_token: String,
    registry: State<'_, ReaderImageRegistry>,
) -> Result<(), String> {
    registry.release(&image_token)
}

#[tauri::command]
pub fn normalize_reader_path(file_path: String) -> Result<String, String> {
    reader::normalize_markdown_path(&file_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn take_pending_open_files(pending: State<'_, PendingOpenFiles>) -> Vec<String> {
    pending.take()
}

#[tauri::command]
pub fn set_reader_watch(
    app: AppHandle,
    file_paths: Vec<String>,
    watcher: State<'_, FileWatcherService>,
) -> Result<WatcherStatus, String> {
    if file_paths.is_empty() {
        watcher.stop()
    } else {
        watcher.set_targets(app, None, &file_paths)
    }
}

#[tauri::command]
pub fn open_external_url(url: String, app: AppHandle) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "只允许打开有效的 HTTPS 链接".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("只允许打开有效的 HTTPS 链接".into());
    }
    app.opener()
        .open_url(parsed.to_string(), None::<String>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_application_locale(locale: String, app: AppHandle) -> Result<(), String> {
    if !matches!(locale.as_str(), "en" | "zh-CN" | "ja") {
        return Err("界面语言无效。".into());
    }
    let menu = crate::application_menu_for_locale(&app, &locale)
        .map_err(|_| "无法更新应用菜单语言。".to_string())?;
    app.set_menu(menu)
        .map(|_| ())
        .map_err(|_| "无法更新应用菜单语言。".to_string())
}

#[tauri::command]
pub fn export_reader_pdf(file_path: String, window: tauri::WebviewWindow) -> Result<(), String> {
    crate::services::pdf_export::export(&window, file_path)
}

pub fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown")
        })
}

pub const OPEN_FILE_EVENT: &str = "mdstudio:open-file";

pub fn enqueue_open_file(app: &AppHandle, path: String) {
    if !is_markdown_file(Path::new(&path)) {
        return;
    }
    if let Some(pending) = app.try_state::<PendingOpenFiles>() {
        pending.push(path.clone());
    }
    let _ = app.emit(OPEN_FILE_EVENT, path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_registry_keeps_open_tabs_until_their_tokens_are_released() {
        let registry = ReaderImageRegistry::default();
        for index in 0..12 {
            registry
                .register(format!("token-{index}"), Vec::new())
                .unwrap();
        }
        assert_eq!(registry.0.lock().unwrap().len(), 12);
        registry.release("token-2").unwrap();
        assert_eq!(registry.0.lock().unwrap().len(), 11);
        assert!(registry.get("token-2", 0).is_err());
    }
}
