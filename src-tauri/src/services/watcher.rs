use notify::{
    event::ModifyKind, Config, Event, EventKind, PollWatcher, RecommendedWatcher, RecursiveMode,
    Watcher,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError},
        Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

const EVENT_NAME: &str = "mdstudio:file-change";
const DEBOUNCE: Duration = Duration::from_millis(280);

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    pub workspace_path: Option<String>,
    pub paths: Vec<String>,
    pub operation: String,
    pub hashes: HashMap<String, Option<String>>,
    pub watcher_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStatus {
    pub watching: bool,
    pub mode: String,
    pub paths: Vec<String>,
}

#[derive(Default)]
struct Runtime {
    native: Option<RecommendedWatcher>,
    polling: Option<PollWatcher>,
    worker: Option<JoinHandle<()>>,
    watched_paths: Vec<PathBuf>,
    workspace_path: Option<PathBuf>,
    mode: String,
}

#[derive(Default)]
pub struct FileWatcherService {
    runtime: Mutex<Runtime>,
}

impl FileWatcherService {
    pub fn set_targets(
        &self,
        app: AppHandle,
        workspace_path: Option<&str>,
        file_paths: &[String],
    ) -> Result<WatcherStatus, String> {
        let workspace = workspace_path.map(PathBuf::from);
        let mut targets: BTreeMap<PathBuf, RecursiveMode> = BTreeMap::new();
        if let Some(path) = workspace.as_ref() {
            let canonical = path.canonicalize().map_err(|error| error.to_string())?;
            if !canonical.is_dir() {
                return Err("工作区路径不是目录".into());
            }
            targets.insert(canonical, RecursiveMode::Recursive);
        }
        for file_path in file_paths {
            let file = PathBuf::from(file_path);
            let parent = file
                .parent()
                .ok_or_else(|| format!("无法监听文件路径：{file_path}"))?
                .canonicalize()
                .map_err(|error| error.to_string())?;
            if workspace
                .as_ref()
                .and_then(|path| path.canonicalize().ok())
                .is_some_and(|root| parent.starts_with(root))
            {
                continue;
            }
            targets.entry(parent).or_insert(RecursiveMode::NonRecursive);
        }

        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "文件监听状态不可用".to_string())?;
        stop_runtime(&mut runtime);
        if targets.is_empty() {
            return Ok(status(&runtime));
        }

        let (tx, rx) = mpsc::channel();
        let native_tx = tx.clone();
        let native = notify::recommended_watcher(move |result| {
            let _ = native_tx.send(result);
        });
        let mut native = native.ok();
        let mut native_ok = native.is_some();
        if let Some(watcher) = native.as_mut() {
            for (path, mode) in &targets {
                if watcher.watch(path, *mode).is_err() {
                    native_ok = false;
                }
            }
        }

        let polling_tx = tx.clone();
        let polling = PollWatcher::new(
            move |result| {
                let _ = polling_tx.send(result);
            },
            Config::default()
                .with_poll_interval(Duration::from_secs(8))
                .with_compare_contents(true),
        );
        let mut polling = polling.ok();
        let mut polling_ok = polling.is_some();
        if let Some(watcher) = polling.as_mut() {
            for (path, mode) in &targets {
                if watcher.watch(path, *mode).is_err() {
                    polling_ok = false;
                }
            }
        }
        drop(tx);

        if !native_ok {
            native = None;
        }
        if !polling_ok {
            polling = None;
        }
        if native.is_none() && polling.is_none() {
            return Err("当前工作区无法启动文件监听或轮询".into());
        }

        let mode = match (native.is_some(), polling.is_some()) {
            (true, true) => "native+poll".to_string(),
            (true, false) => "native".to_string(),
            (false, true) => "polling".to_string(),
            (false, false) => unreachable!(),
        };
        let watched_paths = targets.keys().cloned().collect::<Vec<_>>();
        let root = workspace.clone();
        let worker_mode = mode.clone();
        let worker = thread::Builder::new()
            .name("mdstudio-file-watcher".into())
            .spawn(move || run_worker(rx, app, root, worker_mode))
            .map_err(|error| error.to_string())?;

        runtime.native = native;
        runtime.polling = polling;
        runtime.worker = Some(worker);
        runtime.watched_paths = watched_paths;
        runtime.workspace_path = workspace;
        runtime.mode = mode;
        Ok(status(&runtime))
    }

    pub fn stop(&self) -> Result<WatcherStatus, String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "文件监听状态不可用".to_string())?;
        stop_runtime(&mut runtime);
        Ok(status(&runtime))
    }
}

impl Drop for FileWatcherService {
    fn drop(&mut self) {
        if let Ok(runtime) = self.runtime.get_mut() {
            stop_runtime(runtime);
        }
    }
}

fn status(runtime: &Runtime) -> WatcherStatus {
    WatcherStatus {
        watching: runtime.native.is_some() || runtime.polling.is_some(),
        mode: if runtime.mode.is_empty() {
            "stopped".into()
        } else {
            runtime.mode.clone()
        },
        paths: runtime
            .watched_paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
    }
}

fn stop_runtime(runtime: &mut Runtime) {
    runtime.native.take();
    runtime.polling.take();
    if let Some(worker) = runtime.worker.take() {
        let _ = worker.join();
    }
    runtime.watched_paths.clear();
    runtime.workspace_path = None;
    runtime.mode.clear();
}

fn run_worker(
    receiver: Receiver<notify::Result<Event>>,
    app: AppHandle,
    workspace_path: Option<PathBuf>,
    mode: String,
) {
    let mut pending: HashMap<PathBuf, (String, Instant, Vec<PathBuf>)> = HashMap::new();
    let mut last_hashes: HashMap<String, Option<String>> = HashMap::new();
    loop {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(event)) => {
                let operation = operation_name(&event.kind);
                for path in event.paths {
                    if !is_markdown_or_directory(&path) {
                        continue;
                    }
                    let entry = pending
                        .entry(path.clone())
                        .or_insert_with(|| (operation.clone(), Instant::now(), Vec::new()));
                    entry.0 = merge_operation(&entry.0, &operation);
                    entry.1 = Instant::now();
                    if !entry.2.contains(&path) {
                        entry.2.push(path.clone());
                    }
                }
            }
            Ok(Err(error)) => {
                let _ = app.emit(
                    EVENT_NAME,
                    FileChangeEvent {
                        workspace_path: workspace_path
                            .as_ref()
                            .map(|path| path.to_string_lossy().into_owned()),
                        paths: Vec::new(),
                        operation: format!("watcher_error:{error}"),
                        hashes: HashMap::new(),
                        watcher_mode: mode.clone(),
                    },
                );
            }
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }

        let now = Instant::now();
        let ready = pending
            .iter()
            .filter(|(_, (_, changed_at, _))| now.duration_since(*changed_at) >= DEBOUNCE)
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>();
        for key in ready {
            let Some((operation, _, paths)) = pending.remove(&key) else {
                continue;
            };
            let mut changed_paths = Vec::new();
            let mut hashes = HashMap::new();
            for path in paths {
                let path_string = path.to_string_lossy().into_owned();
                let hash = hash_file(&path);
                if last_hashes.get(&path_string) == Some(&hash) {
                    continue;
                }
                last_hashes.insert(path_string.clone(), hash.clone());
                hashes.insert(path_string.clone(), hash);
                changed_paths.push(path_string);
            }
            if !changed_paths.is_empty() {
                let _ = app.emit(
                    EVENT_NAME,
                    FileChangeEvent {
                        workspace_path: workspace_path
                            .as_ref()
                            .map(|path| path.to_string_lossy().into_owned()),
                        paths: changed_paths,
                        operation,
                        hashes,
                        watcher_mode: mode.clone(),
                    },
                );
            }
        }
    }
}

fn operation_name(kind: &EventKind) -> String {
    match kind {
        EventKind::Create(_) => "created",
        EventKind::Remove(_) => "removed",
        EventKind::Modify(ModifyKind::Name(_)) => "renamed",
        EventKind::Modify(_) => "modified",
        _ => "workspace_changed",
    }
    .to_string()
}

fn merge_operation(current: &str, next: &str) -> String {
    match (current, next) {
        (_, "renamed") => "renamed".into(),
        ("renamed", _) => "renamed".into(),
        (_, "removed") => "removed".into(),
        ("removed", "created") => "renamed".into(),
        ("created", "modified") => "created".into(),
        (_, value) => value.into(),
    }
}

fn is_markdown_or_directory(path: &Path) -> bool {
    if path.is_dir() {
        return true;
    }
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown")
        })
}

fn hash_file(path: &Path) -> Option<String> {
    fs::read(path)
        .ok()
        .map(|bytes| blake3::hash(&bytes).to_hex().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coalesces_create_then_modify_and_keeps_rename_priority() {
        assert_eq!(merge_operation("created", "modified"), "created");
        assert_eq!(merge_operation("modified", "renamed"), "renamed");
        assert_eq!(merge_operation("renamed", "modified"), "renamed");
        assert_eq!(merge_operation("removed", "created"), "renamed");
    }

    #[test]
    fn only_markdown_files_and_directories_are_forwarded() {
        assert!(is_markdown_or_directory(Path::new("doc.md")));
        assert!(is_markdown_or_directory(Path::new("doc.MARKDOWN")));
        assert!(!is_markdown_or_directory(Path::new("image.png")));
    }
}
