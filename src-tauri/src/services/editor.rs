use crate::services::files::{
    self, DocumentSnapshot, FileServiceError, SaveResult, SaveTargetInfo, VersionCheck,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use thiserror::Error;

static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default, Clone)]
pub struct MarkdownEditRegistry(Arc<Mutex<HashMap<String, MarkdownEditGrant>>>);

#[derive(Debug, Clone)]
struct MarkdownEditGrant {
    file_path: String,
    disk_version_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownEditDocument {
    pub session_id: String,
    pub snapshot: DocumentSnapshot,
}

#[derive(Debug, Error)]
pub enum MarkdownEditError {
    #[error("Markdown 编辑会话不存在或已关闭。")]
    SessionClosed,
    #[error("Markdown 编辑会话状态不可用。")]
    StateUnavailable,
    #[error(transparent)]
    File(#[from] FileServiceError),
}

pub fn open_document(
    registry: &MarkdownEditRegistry,
    file_path: &str,
) -> Result<MarkdownEditDocument, MarkdownEditError> {
    let snapshot = files::open_document(file_path)?;
    let canonical_path = Path::new(&snapshot.file_path)
        .canonicalize()
        .map_err(FileServiceError::Io)?
        .to_string_lossy()
        .into_owned();
    let session_id = next_session_id();
    let grant = MarkdownEditGrant {
        file_path: canonical_path,
        disk_version_hash: snapshot.disk_version_hash.clone(),
    };
    registry
        .0
        .lock()
        .map_err(|_| MarkdownEditError::StateUnavailable)?
        .insert(session_id.clone(), grant);
    Ok(MarkdownEditDocument {
        session_id,
        snapshot,
    })
}

pub fn save_document(
    registry: &MarkdownEditRegistry,
    session_id: &str,
    content: &str,
    bom: bool,
    line_ending: &str,
) -> Result<SaveResult, MarkdownEditError> {
    let grant = registry
        .0
        .lock()
        .map_err(|_| MarkdownEditError::StateUnavailable)?
        .get(session_id)
        .cloned()
        .ok_or(MarkdownEditError::SessionClosed)?;
    let result = files::save_document(
        &grant.file_path,
        content,
        Some(&grant.disk_version_hash),
        bom,
        line_ending,
    )?;
    let mut grants = registry
        .0
        .lock()
        .map_err(|_| MarkdownEditError::StateUnavailable)?;
    let current = grants
        .get_mut(session_id)
        .ok_or(MarkdownEditError::SessionClosed)?;
    if current.file_path != grant.file_path || current.disk_version_hash != grant.disk_version_hash
    {
        return Err(MarkdownEditError::File(FileServiceError::Conflict(
            grant.file_path,
        )));
    }
    current.disk_version_hash = result.disk_version_hash.clone();
    Ok(result)
}

pub fn inspect_save_target(file_path: &str) -> Result<SaveTargetInfo, MarkdownEditError> {
    Ok(files::inspect_save_target(file_path)?)
}

pub fn save_as(
    registry: &MarkdownEditRegistry,
    session_id: &str,
    target_path: &str,
    target_hash: Option<&str>,
    content: &str,
    bom: bool,
    line_ending: &str,
) -> Result<SaveResult, MarkdownEditError> {
    let mut grants = registry
        .0
        .lock()
        .map_err(|_| MarkdownEditError::StateUnavailable)?;
    let grant = grants
        .get_mut(session_id)
        .ok_or(MarkdownEditError::SessionClosed)?;
    let target = files::inspect_save_target(target_path)?;
    if target.canonical_path != target_path {
        return Err(MarkdownEditError::File(
            FileServiceError::InvalidMarkdownPath(target_path.into()),
        ));
    }
    let expected_hash = target_hash;
    let result = files::save_document(
        &target.canonical_path,
        content,
        expected_hash,
        bom,
        line_ending,
    )?;
    grant.file_path = result.file_path.clone();
    grant.disk_version_hash = result.disk_version_hash.clone();
    Ok(result)
}

pub fn check_version(
    registry: &MarkdownEditRegistry,
    session_id: &str,
) -> Result<VersionCheck, MarkdownEditError> {
    let grant = registry
        .0
        .lock()
        .map_err(|_| MarkdownEditError::StateUnavailable)?
        .get(session_id)
        .cloned()
        .ok_or(MarkdownEditError::SessionClosed)?;
    Ok(files::check_document_version(
        &grant.file_path,
        &grant.disk_version_hash,
    )?)
}

pub fn release_session(
    registry: &MarkdownEditRegistry,
    session_id: &str,
) -> Result<(), MarkdownEditError> {
    registry
        .0
        .lock()
        .map_err(|_| MarkdownEditError::StateUnavailable)?
        .remove(session_id);
    Ok(())
}

fn next_session_id() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn edit_session_preserves_bom_and_line_endings_and_updates_its_hash() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.md");
        fs::write(&path, b"\xef\xbb\xbf# Title\r\n\r\nBody\r\n").unwrap();
        let registry = MarkdownEditRegistry::default();
        let opened = open_document(&registry, path.to_str().unwrap()).unwrap();
        assert!(opened.snapshot.bom);
        assert_eq!(opened.snapshot.line_ending, files::LineEnding::Crlf);

        let saved = save_document(
            &registry,
            &opened.session_id,
            "# Title\n\nUpdated\n",
            opened.snapshot.bom,
            "crlf",
        )
        .unwrap();
        assert_ne!(saved.disk_version_hash, opened.snapshot.disk_version_hash);
        assert_eq!(
            fs::read(&path).unwrap(),
            b"\xef\xbb\xbf# Title\r\n\r\nUpdated\r\n"
        );
        assert!(
            !check_version(&registry, &opened.session_id)
                .unwrap()
                .changed
        );
    }

    #[test]
    fn external_version_change_blocks_save_and_keeps_external_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.md");
        fs::write(&path, "base").unwrap();
        let registry = MarkdownEditRegistry::default();
        let opened = open_document(&registry, path.to_str().unwrap()).unwrap();
        fs::write(&path, "external").unwrap();

        assert!(
            check_version(&registry, &opened.session_id)
                .unwrap()
                .changed
        );
        assert!(matches!(
            save_document(&registry, &opened.session_id, "draft", false, "lf"),
            Err(MarkdownEditError::File(FileServiceError::Conflict(_)))
        ));
        assert_eq!(fs::read(&path).unwrap(), b"external");
    }

    #[test]
    fn save_as_rebinds_the_authorized_session_and_rejects_non_markdown_paths() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.md");
        let destination = directory.path().join("copy.markdown");
        fs::write(&source, "base").unwrap();
        let registry = MarkdownEditRegistry::default();
        let opened = open_document(&registry, source.to_str().unwrap()).unwrap();

        assert!(matches!(
            save_as(
                &registry,
                &opened.session_id,
                directory.path().join("copy.txt").to_str().unwrap(),
                None,
                "draft",
                false,
                "lf"
            ),
            Err(MarkdownEditError::File(
                FileServiceError::InvalidMarkdownPath(_)
            ))
        ));
        let target_info = inspect_save_target(destination.to_str().unwrap()).unwrap();
        let saved = save_as(
            &registry,
            &opened.session_id,
            &target_info.canonical_path,
            None,
            "draft",
            false,
            "lf",
        )
        .unwrap();
        assert_eq!(saved.file_path, target_info.canonical_path);
        assert_eq!(fs::read(&destination).unwrap(), b"draft");
        assert!(
            !check_version(&registry, &opened.session_id)
                .unwrap()
                .changed
        );
        release_session(&registry, &opened.session_id).unwrap();
        assert!(matches!(
            check_version(&registry, &opened.session_id),
            Err(MarkdownEditError::SessionClosed)
        ));
    }
}
