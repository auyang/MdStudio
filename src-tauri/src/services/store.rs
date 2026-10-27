use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;

const MAX_INDEXED_FILE_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_HISTORY_COUNT: usize = 100;
const DEFAULT_HISTORY_BYTES: u64 = 100 * 1024 * 1024;
const DEFAULT_IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".venv",
];

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("本地文档数据库错误：{0}")]
    Sql(#[from] rusqlite::Error),
    #[error("文件系统错误：{0}")]
    Io(#[from] std::io::Error),
    #[error("工作区目录无效：{0}")]
    InvalidWorkspace(String),
    #[error("搜索内容不能为空")]
    EmptyQuery,
    #[error("恢复草稿过大，无法安全保存")]
    RecoveryTooLarge,
    #[error("未找到指定历史版本：{0}")]
    SnapshotNotFound(String),
}

pub struct LocalStore {
    connection: Mutex<Connection>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub snapshot_id: String,
    pub document_id: String,
    pub file_path: String,
    pub content_hash: String,
    pub created_at: i64,
    pub source: String,
    pub size: u64,
    pub parent_snapshot_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySnapshot {
    pub entry: HistoryEntry,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraft {
    pub document_id: String,
    pub file_path: Option<String>,
    pub base_content: String,
    pub base_hash: Option<String>,
    pub local_content: String,
    pub bom: bool,
    pub line_ending: String,
    pub updated_at: i64,
    pub content_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub file_path: String,
    pub file_name: String,
    pub snippet: String,
    pub match_start: usize,
    pub match_length: usize,
    pub match_in_name: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub indexed_files: usize,
    pub skipped_large_files: usize,
    pub removed_entries: usize,
}

impl LocalStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let db_path = path.as_ref().to_path_buf();
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(&db_path)?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS snapshot_content (
                 content_hash TEXT PRIMARY KEY, content BLOB NOT NULL
             );
             CREATE TABLE IF NOT EXISTS history_snapshots (
                 snapshot_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, file_path TEXT NOT NULL,
                 content_hash TEXT NOT NULL, created_at INTEGER NOT NULL, source TEXT NOT NULL,
                 size INTEGER NOT NULL, parent_snapshot_id TEXT,
                 FOREIGN KEY(content_hash) REFERENCES snapshot_content(content_hash)
             );
             CREATE INDEX IF NOT EXISTS history_path_created ON history_snapshots(file_path, created_at DESC);
             CREATE INDEX IF NOT EXISTS history_document_created ON history_snapshots(document_id, created_at DESC);
             CREATE TABLE IF NOT EXISTS recovery_drafts (
                 document_id TEXT PRIMARY KEY, file_path TEXT, base_content BLOB NOT NULL,
                 base_hash TEXT, local_content BLOB NOT NULL, bom INTEGER NOT NULL,
                 line_ending TEXT NOT NULL, updated_at INTEGER NOT NULL, content_hash TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS store_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE VIRTUAL TABLE IF NOT EXISTS search_docs USING fts5(
                 root_path UNINDEXED, file_path UNINDEXED, file_name, body, cjk,
                 tokenize='unicode61 remove_diacritics 0'
             );",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    #[cfg(test)]
    fn memory() -> Result<Self, StoreError> {
        let connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "CREATE TABLE snapshot_content (content_hash TEXT PRIMARY KEY, content BLOB NOT NULL);
             CREATE TABLE history_snapshots (
                 snapshot_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, file_path TEXT NOT NULL,
                 content_hash TEXT NOT NULL, created_at INTEGER NOT NULL, source TEXT NOT NULL,
                 size INTEGER NOT NULL, parent_snapshot_id TEXT
             );
             CREATE TABLE recovery_drafts (
                 document_id TEXT PRIMARY KEY, file_path TEXT, base_content BLOB NOT NULL,
                 base_hash TEXT, local_content BLOB NOT NULL, bom INTEGER NOT NULL,
                 line_ending TEXT NOT NULL, updated_at INTEGER NOT NULL, content_hash TEXT NOT NULL
             );
             CREATE TABLE store_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE VIRTUAL TABLE search_docs USING fts5(
                 root_path UNINDEXED, file_path UNINDEXED, file_name, body, cjk,
                 tokenize='unicode61 remove_diacritics 0'
             );",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn record_snapshot(
        &self,
        document_id: &str,
        file_path: &str,
        content: &str,
        source: &str,
    ) -> Result<HistoryEntry, StoreError> {
        let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
        let created_at = now_ms();
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let transaction = connection.unchecked_transaction()?;
        if let Some(entry) = latest_matching(&transaction, document_id, file_path, &hash, source)? {
            transaction.commit()?;
            return Ok(entry);
        }
        let parent: Option<String> = transaction
            .query_row(
                "SELECT snapshot_id FROM history_snapshots WHERE document_id=?1 OR file_path=?2
             ORDER BY created_at DESC LIMIT 1",
                params![document_id, file_path],
                |row| row.get(0),
            )
            .optional()?;
        transaction.execute(
            "INSERT OR IGNORE INTO snapshot_content(content_hash, content) VALUES(?1, ?2)",
            params![hash, content.as_bytes()],
        )?;
        let snapshot_id = blake3::hash(
            format!("{document_id}:{file_path}:{hash}:{source}:{created_at}").as_bytes(),
        )
        .to_hex()
        .to_string();
        transaction.execute(
            "INSERT INTO history_snapshots(snapshot_id, document_id, file_path, content_hash,
                 created_at, source, size, parent_snapshot_id)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                snapshot_id,
                document_id,
                file_path,
                hash,
                created_at,
                source,
                content.len() as i64,
                parent,
            ],
        )?;
        let entry = HistoryEntry {
            snapshot_id,
            document_id: document_id.into(),
            file_path: file_path.into(),
            content_hash: hash,
            created_at,
            source: source.into(),
            size: content.len() as u64,
            parent_snapshot_id: parent,
        };
        prune_history(&transaction)?;
        transaction.commit()?;
        Ok(entry)
    }

    pub fn list_history(&self, file_path: &str) -> Result<Vec<HistoryEntry>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let mut statement = connection.prepare(
            "SELECT snapshot_id, document_id, file_path, content_hash, created_at, source, size, parent_snapshot_id
             FROM history_snapshots WHERE file_path=?1 ORDER BY created_at DESC LIMIT 200",
        )?;
        let rows = statement.query_map([file_path], map_history_entry)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub fn read_snapshot(&self, snapshot_id: &str) -> Result<HistorySnapshot, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        connection
            .query_row(
                "SELECT h.snapshot_id, h.document_id, h.file_path, h.content_hash, h.created_at,
                    h.source, h.size, h.parent_snapshot_id, c.content
             FROM history_snapshots h JOIN snapshot_content c USING(content_hash)
             WHERE h.snapshot_id=?1",
                [snapshot_id],
                |row| {
                    let entry = map_history_entry(row)?;
                    let bytes: Vec<u8> = row.get(8)?;
                    Ok(HistorySnapshot {
                        entry,
                        content: String::from_utf8_lossy(&bytes).into_owned(),
                    })
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::SnapshotNotFound(snapshot_id.into()))
    }

    pub fn set_history_limits(&self, max_count: usize, max_bytes: u64) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let transaction = connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO store_settings(key, value) VALUES('history_count_limit', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [max_count.clamp(10, 1000).to_string()],
        )?;
        transaction.execute(
            "INSERT INTO store_settings(key, value) VALUES('history_bytes_limit', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [max_bytes
                .clamp(10 * 1024 * 1024, 2 * 1024 * 1024 * 1024)
                .to_string()],
        )?;
        prune_history(&transaction)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn save_recovery(&self, mut draft: RecoveryDraft) -> Result<(), StoreError> {
        if draft.local_content.len() > 32 * 1024 * 1024 {
            return Err(StoreError::RecoveryTooLarge);
        }
        draft.content_hash = blake3::hash(draft.local_content.as_bytes())
            .to_hex()
            .to_string();
        draft.updated_at = now_ms();
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        connection.execute(
            "INSERT INTO recovery_drafts(document_id, file_path, base_content, base_hash, local_content,
                 bom, line_ending, updated_at, content_hash)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(document_id) DO UPDATE SET file_path=excluded.file_path,
                 base_content=excluded.base_content, base_hash=excluded.base_hash,
                 local_content=excluded.local_content, bom=excluded.bom,
                 line_ending=excluded.line_ending, updated_at=excluded.updated_at,
                 content_hash=excluded.content_hash
             WHERE recovery_drafts.content_hash != excluded.content_hash
                OR recovery_drafts.base_hash IS NOT excluded.base_hash
                OR recovery_drafts.file_path IS NOT excluded.file_path",
            params![
                draft.document_id, draft.file_path, draft.base_content.as_bytes(),
                draft.base_hash, draft.local_content.as_bytes(), draft.bom as i32,
                draft.line_ending, draft.updated_at, draft.content_hash,
            ],
        )?;
        Ok(())
    }

    pub fn list_recovery(&self) -> Result<Vec<RecoveryDraft>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let mut statement = connection.prepare(
            "SELECT document_id, file_path, base_content, base_hash, local_content, bom,
                    line_ending, updated_at, content_hash FROM recovery_drafts ORDER BY updated_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            let base: Vec<u8> = row.get(2)?;
            let local: Vec<u8> = row.get(4)?;
            Ok(RecoveryDraft {
                document_id: row.get(0)?,
                file_path: row.get(1)?,
                base_content: String::from_utf8_lossy(&base).into_owned(),
                base_hash: row.get(3)?,
                local_content: String::from_utf8_lossy(&local).into_owned(),
                bom: row.get::<_, i32>(5)? != 0,
                line_ending: row.get(6)?,
                updated_at: row.get(7)?,
                content_hash: row.get(8)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub fn delete_recovery(&self, document_id: &str) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        connection.execute(
            "DELETE FROM recovery_drafts WHERE document_id=?1",
            [document_id],
        )?;
        Ok(())
    }

    pub fn index_workspace(
        &self,
        root_path: &str,
        extra_excluded: &[String],
    ) -> Result<IndexStatus, StoreError> {
        let root = canonical_workspace(root_path)?;
        let mut files = Vec::new();
        let mut skipped_large_files = 0;
        walk_markdown(
            &root,
            &root,
            extra_excluded,
            &mut files,
            &mut skipped_large_files,
        )?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let transaction = connection.unchecked_transaction()?;
        let root_string = root.to_string_lossy().into_owned();
        let removed_entries =
            transaction.execute("DELETE FROM search_docs WHERE root_path=?1", [&root_string])?;
        for (path, name, content) in &files {
            insert_indexed_file(&transaction, &root_string, path, name, content)?;
        }
        transaction.commit()?;
        Ok(IndexStatus {
            indexed_files: files.len(),
            skipped_large_files,
            removed_entries,
        })
    }

    pub fn update_index_paths(
        &self,
        root_path: &str,
        changed_paths: &[String],
    ) -> Result<IndexStatus, StoreError> {
        let root = canonical_workspace(root_path)?;
        let root_string = root.to_string_lossy().into_owned();
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let transaction = connection.unchecked_transaction()?;
        let mut indexed_files = 0;
        let mut skipped_large_files = 0;
        let mut removed_entries = 0;
        for changed in changed_paths {
            let lexical = PathBuf::from(changed);
            let absolute = if lexical.is_absolute() {
                lexical
            } else {
                root.join(lexical)
            };
            let canonical = if absolute.exists() {
                absolute.canonicalize()?
            } else {
                let Some(file_name) = absolute.file_name() else {
                    continue;
                };
                absolute
                    .parent()
                    .unwrap_or(&root)
                    .canonicalize()?
                    .join(file_name)
            };
            if !canonical.starts_with(&root) {
                continue;
            }
            let path_string = canonical.to_string_lossy().into_owned();
            removed_entries += transaction.execute(
                "DELETE FROM search_docs WHERE root_path=?1 AND file_path=?2",
                params![root_string, path_string],
            )?;
            let metadata = match fs::symlink_metadata(&absolute) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(StoreError::Io(error)),
            };
            if metadata.file_type().is_symlink() || !metadata.is_file() || !is_markdown(&absolute) {
                continue;
            }
            if metadata.len() > MAX_INDEXED_FILE_BYTES {
                skipped_large_files += 1;
                continue;
            }
            let content = fs::read_to_string(&absolute)?;
            let name = absolute
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            insert_indexed_file(&transaction, &root_string, &path_string, name, &content)?;
            indexed_files += 1;
        }
        transaction.commit()?;
        Ok(IndexStatus {
            indexed_files,
            skipped_large_files,
            removed_entries,
        })
    }

    pub fn search_workspace(
        &self,
        root_path: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SearchResult>, StoreError> {
        let root = canonical_workspace(root_path)?;
        let query = query.trim();
        if query.is_empty() {
            return Err(StoreError::EmptyQuery);
        }
        let match_query = build_fts_query(query);
        if match_query.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let mut statement = connection.prepare(
            "SELECT file_path, file_name, body FROM search_docs
             WHERE root_path=?1 AND search_docs MATCH ?2 ORDER BY bm25(search_docs) LIMIT ?3",
        )?;
        let rows = statement.query_map(
            params![
                root.to_string_lossy(),
                match_query,
                limit.clamp(1, 100) as i64
            ],
            |row| {
                let file_path: String = row.get(0)?;
                let file_name: String = row.get(1)?;
                let body: String = row.get(2)?;
                Ok(make_search_result(file_path, file_name, body, query))
            },
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }
}

fn latest_matching(
    transaction: &Transaction<'_>,
    document_id: &str,
    file_path: &str,
    hash: &str,
    source: &str,
) -> Result<Option<HistoryEntry>, rusqlite::Error> {
    transaction.query_row(
        "SELECT snapshot_id, document_id, file_path, content_hash, created_at, source, size, parent_snapshot_id
         FROM history_snapshots WHERE (document_id=?1 OR file_path=?2)
             AND content_hash=?3 AND source=?4 ORDER BY created_at DESC LIMIT 1",
        params![document_id, file_path, hash, source],
        map_history_entry,
    ).optional()
}

fn map_history_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        snapshot_id: row.get(0)?,
        document_id: row.get(1)?,
        file_path: row.get(2)?,
        content_hash: row.get(3)?,
        created_at: row.get(4)?,
        source: row.get(5)?,
        size: row.get::<_, i64>(6)?.max(0) as u64,
        parent_snapshot_id: row.get(7)?,
    })
}

fn prune_history(transaction: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    let max_count = read_setting(
        transaction,
        "history_count_limit",
        DEFAULT_HISTORY_COUNT as u64,
    )? as usize;
    let max_bytes = read_setting(transaction, "history_bytes_limit", DEFAULT_HISTORY_BYTES)?;
    let mut statement = transaction.prepare(
        "SELECT snapshot_id, document_id, source, size FROM history_snapshots ORDER BY created_at DESC",
    )?;
    let entries = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, u64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut per_document = std::collections::HashMap::<String, usize>::new();
    let mut kept_count = 0usize;
    let mut kept_bytes = 0u64;
    let mut delete = Vec::new();
    for (snapshot_id, document_id, source, size) in entries {
        let count = per_document.entry(document_id).or_default();
        let preserve = *count < 5 || source == "before_merge";
        if preserve || (kept_count < max_count && kept_bytes.saturating_add(size) <= max_bytes) {
            *count += 1;
            kept_count += 1;
            kept_bytes = kept_bytes.saturating_add(size);
        } else {
            delete.push(snapshot_id);
        }
    }
    for snapshot_id in delete {
        transaction.execute(
            "DELETE FROM history_snapshots WHERE snapshot_id=?1",
            [snapshot_id],
        )?;
    }
    transaction.execute(
        "DELETE FROM snapshot_content WHERE content_hash NOT IN (SELECT content_hash FROM history_snapshots)",
        [],
    )?;
    Ok(())
}

fn read_setting(
    transaction: &Transaction<'_>,
    key: &str,
    fallback: u64,
) -> Result<u64, rusqlite::Error> {
    let value = transaction
        .query_row(
            "SELECT value FROM store_settings WHERE key=?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(value
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback))
}

fn canonical_workspace(path: &str) -> Result<PathBuf, StoreError> {
    let root = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| StoreError::InvalidWorkspace(path.into()))?;
    if !root.is_dir() {
        return Err(StoreError::InvalidWorkspace(path.into()));
    }
    Ok(root)
}

fn walk_markdown(
    root: &Path,
    directory: &Path,
    extra_excluded: &[String],
    files: &mut Vec<(String, String, String)>,
    skipped_large: &mut usize,
) -> Result<(), StoreError> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.')
                || DEFAULT_IGNORED_DIRS.contains(&name.as_str())
                || extra_excluded.iter().any(|pattern| pattern == &name)
            {
                continue;
            }
            walk_markdown(root, &path, extra_excluded, files, skipped_large)?;
        } else if file_type.is_file() && is_markdown(&path) {
            let metadata = entry.metadata()?;
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string();
            if metadata.len() > MAX_INDEXED_FILE_BYTES {
                *skipped_large += 1;
                files.push((path.to_string_lossy().into_owned(), name, String::new()));
                continue;
            }
            let canonical = path.canonicalize()?;
            if !canonical.starts_with(root) {
                continue;
            }
            let content = fs::read_to_string(&canonical)?;
            files.push((canonical.to_string_lossy().into_owned(), name, content));
        }
    }
    Ok(())
}

fn insert_indexed_file(
    transaction: &Transaction<'_>,
    root: &str,
    path: &str,
    name: &str,
    content: &str,
) -> Result<(), rusqlite::Error> {
    transaction.execute(
        "INSERT INTO search_docs(root_path, file_path, file_name, body, cjk) VALUES(?1, ?2, ?3, ?4, ?5)",
        params![root, path, name, content, cjk_tokens(&format!("{name}\n{content}"))],
    )?;
    Ok(())
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown")
        })
}

fn is_cjk(character: char) -> bool {
    matches!(character as u32,
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF |
        0x3040..=0x30FF | 0xAC00..=0xD7AF)
}

fn cjk_tokens(text: &str) -> String {
    let mut tokens = Vec::new();
    let mut run = Vec::new();
    let flush = |run: &mut Vec<char>, tokens: &mut Vec<String>| {
        for index in 0..run.len() {
            tokens.push(run[index].to_string());
            if index + 1 < run.len() {
                tokens.push(format!("{}{}", run[index], run[index + 1]));
            }
            if index + 2 < run.len() {
                tokens.push(format!(
                    "{}{}{}",
                    run[index],
                    run[index + 1],
                    run[index + 2]
                ));
            }
        }
        run.clear();
    };
    for character in text.chars() {
        if is_cjk(character) {
            run.push(character);
        } else if !run.is_empty() {
            flush(&mut run, &mut tokens);
        }
    }
    if !run.is_empty() {
        flush(&mut run, &mut tokens);
    }
    tokens.join(" ")
}

fn build_fts_query(query: &str) -> String {
    let mut clauses = Vec::new();
    let mut latin = String::new();
    let mut cjk_run = Vec::new();
    let flush_latin = |word: &mut String, clauses: &mut Vec<String>| {
        if !word.is_empty() {
            let quoted = word.replace('"', "\"\"");
            clauses.push(format!("(file_name : \"{quoted}\" OR body : \"{quoted}\")"));
            word.clear();
        }
    };
    let flush_cjk = |run: &mut Vec<char>, clauses: &mut Vec<String>| {
        if run.is_empty() {
            return;
        }
        let windows = if run.len() == 1 {
            vec![run.iter().collect::<String>()]
        } else {
            run.windows(2).map(|pair| pair.iter().collect()).collect()
        };
        for token in windows {
            clauses.push(format!("cjk : \"{}\"", token.replace('"', "\"\"")));
        }
        run.clear();
    };
    for character in query.chars() {
        if is_cjk(character) {
            flush_latin(&mut latin, &mut clauses);
            cjk_run.push(character);
        } else if character.is_alphanumeric() || character == '_' {
            flush_cjk(&mut cjk_run, &mut clauses);
            latin.push(character);
        } else {
            flush_latin(&mut latin, &mut clauses);
            flush_cjk(&mut cjk_run, &mut clauses);
        }
    }
    flush_latin(&mut latin, &mut clauses);
    flush_cjk(&mut cjk_run, &mut clauses);
    clauses.join(" AND ")
}

fn make_search_result(
    file_path: String,
    file_name: String,
    body: String,
    query: &str,
) -> SearchResult {
    if let Some(position) = find_char_offset(&body, query) {
        let start = position.saturating_sub(60);
        let snippet = body.chars().skip(start).take(180).collect();
        return SearchResult {
            file_path,
            file_name,
            snippet,
            match_start: position - start,
            match_length: query.chars().count().max(1),
            match_in_name: false,
        };
    }
    if let Some(position) = find_char_offset(&file_name, query) {
        let start = position.saturating_sub(60);
        let snippet = file_name.chars().skip(start).take(180).collect();
        return SearchResult {
            file_path,
            file_name: file_name.clone(),
            snippet,
            match_start: position - start,
            match_length: file_name
                .chars()
                .count()
                .saturating_sub(position)
                .min(query.chars().count()),
            match_in_name: true,
        };
    }
    let snippet = if body.is_empty() {
        file_name.clone()
    } else {
        body.chars().take(180).collect()
    };
    SearchResult {
        file_path,
        file_name,
        snippet,
        match_start: 0,
        match_length: 0,
        match_in_name: false,
    }
}

fn find_char_offset(text: &str, query: &str) -> Option<usize> {
    let lower = text.to_lowercase();
    let query = query.to_lowercase();
    lower
        .find(&query)
        .map(|byte_offset| lower[..byte_offset].chars().count())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn store() -> LocalStore {
        LocalStore::memory().unwrap()
    }

    #[test]
    fn history_deduplicates_content_and_preserves_parent_chain() {
        let store = store();
        let first = store
            .record_snapshot("doc-1", "/tmp/n.md", "基础", "user_save")
            .unwrap();
        let duplicate = store
            .record_snapshot("doc-1", "/tmp/n.md", "基础", "user_save")
            .unwrap();
        let next = store
            .record_snapshot("doc-1", "/tmp/n.md", "新基础", "external_change")
            .unwrap();
        assert_eq!(first.snapshot_id, duplicate.snapshot_id);
        assert_eq!(
            next.parent_snapshot_id.as_deref(),
            Some(first.snapshot_id.as_str())
        );
        assert_eq!(
            store.read_snapshot(&first.snapshot_id).unwrap().content,
            "基础"
        );
    }

    #[test]
    fn recovery_round_trip_keeps_base_and_local_separate() {
        let store = store();
        store
            .save_recovery(RecoveryDraft {
                document_id: "doc-1".into(),
                file_path: Some("/tmp/n.md".into()),
                base_content: "base".into(),
                base_hash: Some("h1".into()),
                local_content: "local".into(),
                bom: true,
                line_ending: "crlf".into(),
                updated_at: 0,
                content_hash: String::new(),
            })
            .unwrap();
        let draft = store.list_recovery().unwrap().pop().unwrap();
        assert_eq!(draft.base_content, "base");
        assert_eq!(draft.local_content, "local");
        assert!(draft.bom);
        store.delete_recovery("doc-1").unwrap();
        assert!(store.list_recovery().unwrap().is_empty());
    }

    #[test]
    fn chinese_search_matches_single_double_long_queries_and_incremental_delete() {
        let store = store();
        let root = tempdir().unwrap();
        let note = root.path().join("中文文档.md");
        fs::write(
            &note,
            "MdStudio 本地文档搜索\n\n中文连续文本包含工作区协作能力。",
        )
        .unwrap();
        let root_text = root.path().to_string_lossy().into_owned();
        assert_eq!(
            store
                .index_workspace(&root_text, &[])
                .unwrap()
                .indexed_files,
            1
        );
        assert_eq!(
            store.search_workspace(&root_text, "文", 20).unwrap().len(),
            1
        );
        assert_eq!(
            store
                .search_workspace(&root_text, "中文", 20)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            store
                .search_workspace(&root_text, "工作区协作", 20)
                .unwrap()
                .len(),
            1
        );
        fs::remove_file(&note).unwrap();
        store
            .update_index_paths(&root_text, &[note.to_string_lossy().into_owned()])
            .unwrap();
        assert!(store
            .search_workspace(&root_text, "中文", 20)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn workspace_index_skips_symlinks_and_ignored_directories() {
        let store = store();
        let root = tempdir().unwrap();
        let ignored = root.path().join("node_modules");
        fs::create_dir(&ignored).unwrap();
        fs::write(ignored.join("vendor.md"), "不能命中").unwrap();
        fs::write(root.path().join("doc.md"), "普通内容").unwrap();
        let status = store
            .index_workspace(root.path().to_str().unwrap(), &[])
            .unwrap();
        assert_eq!(status.indexed_files, 1);
        assert_eq!(
            store
                .search_workspace(root.path().to_str().unwrap(), "不能命中", 10)
                .unwrap()
                .len(),
            0
        );
    }
}
