use crate::services::documents::DocumentType;
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use thiserror::Error;

const MAX_DIRECTORY_ENTRIES: usize = 2_000;
const IGNORED_DIRECTORIES: &[&str] = &[
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
pub enum WorkspaceError {
    #[error("工作区路径无效：{0}")]
    InvalidPath(String),
    #[error("工作区目录不存在或无法访问：{0}")]
    Inaccessible(String),
    #[error("工作区尚未打开。")]
    NotOpen,
    #[error("拒绝访问工作区之外的路径。")]
    OutsideRoot,
    #[error("不允许通过符号链接访问工作区内容。")]
    Symlink,
    #[error("文件名无效；请使用不含路径分隔符的名称。")]
    InvalidName,
    #[error("只支持新建 .md 或 .markdown 文件。")]
    InvalidMarkdownName,
    #[error("目标文件已存在：{0}")]
    AlreadyExists(String),
    #[error("工作区状态不可用。")]
    StateUnavailable,
    #[error("文件系统错误：{0}")]
    Io(#[from] io::Error),
}

#[derive(Default)]
pub struct WorkspaceRegistry(Mutex<Option<PathBuf>>);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRoot {
    pub path: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub document_type: Option<DocumentType>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirectoryListing {
    pub directory_path: String,
    pub entries: Vec<WorkspaceEntry>,
    pub truncated: bool,
}

pub fn open_workspace(
    registry: &WorkspaceRegistry,
    requested_path: &str,
) -> Result<WorkspaceRoot, WorkspaceError> {
    let requested = Path::new(requested_path);
    if !requested.is_absolute()
        || requested
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(WorkspaceError::InvalidPath(requested_path.to_string()));
    }
    let metadata = fs::symlink_metadata(requested)
        .map_err(|_| WorkspaceError::Inaccessible(requested_path.to_string()))?;
    if metadata.file_type().is_symlink() {
        return Err(WorkspaceError::Symlink);
    }
    if !metadata.is_dir() {
        return Err(WorkspaceError::InvalidPath(requested_path.to_string()));
    }
    let root = requested
        .canonicalize()
        .map_err(|_| WorkspaceError::Inaccessible(requested_path.to_string()))?;
    *registry
        .0
        .lock()
        .map_err(|_| WorkspaceError::StateUnavailable)? = Some(root.clone());
    Ok(WorkspaceRoot {
        display_name: root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_else(|| root.to_str().unwrap_or("工作区"))
            .to_string(),
        path: root.to_string_lossy().into_owned(),
    })
}

pub fn list_directory(
    registry: &WorkspaceRegistry,
    requested_path: &str,
) -> Result<WorkspaceDirectoryListing, WorkspaceError> {
    let directory = authorize_directory(registry, requested_path)?;
    let mut entries = Vec::new();
    let mut truncated = false;
    let read_dir = fs::read_dir(&directory)
        .map_err(|_| WorkspaceError::Inaccessible(requested_path.to_string()))?;

    for entry in read_dir {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) if !metadata.file_type().is_symlink() => metadata,
            Ok(_) => continue,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(WorkspaceError::Io(error)),
        };
        if metadata.is_dir() {
            if IGNORED_DIRECTORIES
                .iter()
                .any(|ignored| name.eq_ignore_ascii_case(ignored))
            {
                continue;
            }
            entries.push(WorkspaceEntry {
                name,
                path: entry.path().to_string_lossy().into_owned(),
                is_directory: true,
                document_type: None,
            });
        } else if metadata.is_file() {
            let document_type = crate::services::documents::document_type(&entry.path());
            if let Some(document_type) = document_type {
                entries.push(WorkspaceEntry {
                    name,
                    path: entry.path().to_string_lossy().into_owned(),
                    is_directory: false,
                    document_type: Some(document_type),
                });
            }
        }
    }

    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    if entries.len() > MAX_DIRECTORY_ENTRIES {
        entries.truncate(MAX_DIRECTORY_ENTRIES);
        truncated = true;
    }

    Ok(WorkspaceDirectoryListing {
        directory_path: directory.to_string_lossy().into_owned(),
        entries,
        truncated,
    })
}

pub fn create_markdown_file(
    registry: &WorkspaceRegistry,
    directory_path: &str,
    requested_name: &str,
) -> Result<WorkspaceEntry, WorkspaceError> {
    let directory = authorize_directory(registry, directory_path)?;
    let file_name = validated_markdown_name(requested_name)?;
    let path = directory.join(&file_name);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    let file: File = options.open(&path).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            WorkspaceError::AlreadyExists(file_name.clone())
        } else {
            WorkspaceError::Io(error)
        }
    })?;
    file.sync_all()?;
    Ok(WorkspaceEntry {
        name: file_name,
        path: path.to_string_lossy().into_owned(),
        is_directory: false,
        document_type: Some(DocumentType::Markdown),
    })
}

fn authorize_directory(
    registry: &WorkspaceRegistry,
    requested_path: &str,
) -> Result<PathBuf, WorkspaceError> {
    let root = registry
        .0
        .lock()
        .map_err(|_| WorkspaceError::StateUnavailable)?
        .clone()
        .ok_or(WorkspaceError::NotOpen)?;
    let requested = Path::new(requested_path);
    if !requested.is_absolute()
        || requested
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(WorkspaceError::InvalidPath(requested_path.to_string()));
    }
    if !requested.starts_with(&root) {
        return Err(WorkspaceError::OutsideRoot);
    }

    let relative = requested
        .strip_prefix(&root)
        .map_err(|_| WorkspaceError::OutsideRoot)?;
    let mut current = root.clone();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(WorkspaceError::InvalidPath(requested_path.to_string()));
        };
        current.push(name);
        let metadata = fs::symlink_metadata(&current).map_err(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                WorkspaceError::Inaccessible(requested_path.to_string())
            } else {
                WorkspaceError::Io(error)
            }
        })?;
        if metadata.file_type().is_symlink() {
            return Err(WorkspaceError::Symlink);
        }
        if !metadata.is_dir() {
            return Err(WorkspaceError::InvalidPath(requested_path.to_string()));
        }
    }
    Ok(current)
}

fn validated_markdown_name(requested_name: &str) -> Result<String, WorkspaceError> {
    let name = requested_name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.len() > 240
        || name.ends_with('.')
        || name.ends_with(' ')
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
        })
        || Path::new(name).file_name().and_then(|leaf| leaf.to_str()) != Some(name)
    {
        return Err(WorkspaceError::InvalidName);
    }
    let path = Path::new(name);
    if let Some(extension) = path.extension() {
        if !matches!(
            extension.to_string_lossy().to_ascii_lowercase().as_str(),
            "md" | "markdown"
        ) {
            return Err(WorkspaceError::InvalidMarkdownName);
        }
    }
    let stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
    {
        return Err(WorkspaceError::InvalidName);
    }
    Ok(if path.extension().is_some() {
        name.to_string()
    } else {
        format!("{name}.md")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("mdstudio-workspace-{label}-{unique}"));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn opened(path: &Path) -> (WorkspaceRegistry, WorkspaceRoot) {
        let registry = WorkspaceRegistry::default();
        let root = open_workspace(&registry, path.to_str().unwrap()).unwrap();
        (registry, root)
    }

    #[test]
    fn listing_is_lazy_immediate_only_document_filtered_and_directories_first() {
        let temp = TestDirectory::new("listing");
        fs::create_dir(temp.0.join("subfolder")).unwrap();
        fs::create_dir(temp.0.join(".git")).unwrap();
        fs::create_dir(temp.0.join("node_modules")).unwrap();
        fs::write(temp.0.join("z.PDF"), b"").unwrap();
        fs::write(temp.0.join("a.markdown"), b"").unwrap();
        fs::write(temp.0.join("hidden.txt"), b"").unwrap();
        fs::write(temp.0.join("subfolder/nested.md"), b"").unwrap();
        let (registry, root) = opened(&temp.0);
        let listing = list_directory(&registry, &root.path).unwrap();
        assert_eq!(
            listing
                .entries
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["subfolder", "a.markdown", "z.PDF"]
        );
        assert!(list_directory(&registry, &listing.entries[0].path)
            .unwrap()
            .entries
            .iter()
            .any(|entry| entry.name == "nested.md"));
        assert!(!listing
            .entries
            .iter()
            .any(|entry| entry.name == "nested.md"));
    }

    #[test]
    fn rejects_outside_paths_and_symlinks() {
        let temp = TestDirectory::new("boundary");
        let outside = TestDirectory::new("outside");
        fs::create_dir(temp.0.join("inner")).unwrap();
        let (registry, root) = opened(&temp.0);
        assert!(matches!(
            list_directory(&registry, outside.0.to_str().unwrap()),
            Err(WorkspaceError::OutsideRoot)
        ));
        assert!(list_directory(&registry, &format!("{}/../outside", root.path)).is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside.0, temp.0.join("linked")).unwrap();
            let linked = Path::new(&root.path).join("linked");
            assert!(matches!(
                list_directory(&registry, &linked.to_string_lossy()),
                Err(WorkspaceError::Symlink)
            ));
            let listing = list_directory(&registry, &root.path).unwrap();
            assert!(!listing.entries.iter().any(|entry| entry.name == "linked"));
            let root_link = temp.0.join("root-link");
            std::os::unix::fs::symlink(&outside.0, &root_link).unwrap();
            assert!(matches!(
                open_workspace(&WorkspaceRegistry::default(), &root_link.to_string_lossy()),
                Err(WorkspaceError::Symlink)
            ));
        }
    }

    #[test]
    fn new_markdown_creation_never_overwrites_existing_files() {
        let temp = TestDirectory::new("create");
        let (registry, root) = opened(&temp.0);
        let entry = create_markdown_file(&registry, &root.path, "新文档").unwrap();
        assert_eq!(entry.name, "新文档.md");
        assert_eq!(fs::read(&entry.path).unwrap(), b"");
        fs::write(&entry.path, b"existing").unwrap();
        assert!(matches!(
            create_markdown_file(&registry, &root.path, "新文档.md"),
            Err(WorkspaceError::AlreadyExists(_))
        ));
        assert_eq!(fs::read(entry.path).unwrap(), b"existing");
    }

    #[test]
    fn validates_creation_names_and_extensions() {
        assert_eq!(validated_markdown_name("note").unwrap(), "note.md");
        assert_eq!(
            validated_markdown_name("note.markdown").unwrap(),
            "note.markdown"
        );
        assert!(matches!(
            validated_markdown_name("../escape.md"),
            Err(WorkspaceError::InvalidName)
        ));
        assert!(matches!(
            validated_markdown_name("report.pdf"),
            Err(WorkspaceError::InvalidMarkdownName)
        ));
        assert!(matches!(
            validated_markdown_name("CON"),
            Err(WorkspaceError::InvalidName)
        ));
    }
}
