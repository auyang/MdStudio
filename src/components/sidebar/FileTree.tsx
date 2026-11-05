import { invoke } from '@tauri-apps/api/core'
import {
  AlertCircle, ChevronDown, ChevronRight, FilePlus2, FileText, Folder,
  FolderOpen, LoaderCircle, RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, PointerEvent } from 'react'
import type { WorkspaceDirectoryListing, WorkspaceEntry, WorkspaceRoot } from '../../features/workspace/types'
import { useI18n } from '../../features/i18n'

interface FileTreeProps {
  workspace: WorkspaceRoot
  activePath: string | null
  width: number
  collapsed: boolean
  onWidthChange: (width: number) => void
  onChooseWorkspace: () => void
  onOpen: (path: string) => void
  onCreateMarkdown: (directoryPath: string, fileName: string) => Promise<void>
  embedded?: boolean
}

export function FileTree({ workspace, activePath, width, collapsed, onWidthChange, onChooseWorkspace, onOpen, onCreateMarkdown, embedded = false }: FileTreeProps) {
  const t = useI18n()
  const [entriesByPath, setEntriesByPath] = useState<Record<string, WorkspaceEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [truncated, setTruncated] = useState<Set<string>>(() => new Set())
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const loaded = useRef(new Set<string>())
  const pending = useRef(new Set<string>())
  const requestTokens = useRef(new Map<string, number>())
  const workspaceEpoch = useRef(0)
  const expandedRef = useRef(expanded)
  const resizeOrigin = useRef<{ x: number; width: number } | null>(null)

  const loadDirectory = useCallback(async (directoryPath: string, force = false) => {
    if (!force && loaded.current.has(directoryPath)) return
    if (!force && pending.current.has(directoryPath)) return
    const epoch = workspaceEpoch.current
    const token = (requestTokens.current.get(directoryPath) ?? 0) + 1
    requestTokens.current.set(directoryPath, token)
    pending.current.add(directoryPath)
    setLoading(value => new Set(value).add(directoryPath))
    setErrors(value => {
      const next = { ...value }
      delete next[directoryPath]
      return next
    })
    try {
      const listing = await invoke<WorkspaceDirectoryListing>('list_workspace_directory', { directoryPath })
      if (workspaceEpoch.current !== epoch || requestTokens.current.get(directoryPath) !== token) return
      loaded.current.add(directoryPath)
      setEntriesByPath(value => ({ ...value, [directoryPath]: listing.entries }))
      setTruncated(value => {
        const next = new Set(value)
        if (listing.truncated) next.add(directoryPath)
        else next.delete(directoryPath)
        return next
      })
    } catch (reason) {
      if (workspaceEpoch.current !== epoch || requestTokens.current.get(directoryPath) !== token) return
      setErrors(value => ({ ...value, [directoryPath]: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      if (workspaceEpoch.current === epoch && requestTokens.current.get(directoryPath) === token) {
        pending.current.delete(directoryPath)
        setLoading(value => {
          const next = new Set(value)
          next.delete(directoryPath)
          return next
        })
      }
    }
  }, [])

  useEffect(() => {
    workspaceEpoch.current += 1
    loaded.current.clear()
    pending.current.clear()
    requestTokens.current.clear()
    expandedRef.current = new Set()
    setExpanded(new Set())
    setEntriesByPath({})
    setErrors({})
    setTruncated(new Set())
    setLoading(new Set())
    setCreateError('')
    void loadDirectory(workspace.path, true)
    return () => { workspaceEpoch.current += 1 }
  }, [workspace.path, loadDirectory])

  const toggleDirectory = (path: string) => {
    const next = new Set(expandedRef.current)
    if (next.has(path)) next.delete(path)
    else {
      next.add(path)
      void loadDirectory(path)
    }
    expandedRef.current = next
    setExpanded(next)
  }

  const refresh = async () => {
    loaded.current.clear()
    await Promise.all([workspace.path, ...expandedRef.current].map(path => loadDirectory(path, true)))
  }

  const submitNewFile = async (event: FormEvent) => {
    event.preventDefault()
    const name = newFileName.trim()
    if (!name || creating) return
    setCreating(true)
    setCreateError('')
    try {
      await onCreateMarkdown(workspace.path, name)
      setNewFileName('')
      setNewFileOpen(false)
      loaded.current.delete(workspace.path)
      await loadDirectory(workspace.path, true)
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason)
      setCreateError(localizeError(t, detail))
    } finally {
      setCreating(false)
    }
  }

  const onResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    resizeOrigin.current = { x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeOrigin.current) onWidthChange(resizeOrigin.current.width + event.clientX - resizeOrigin.current.x)
  }
  const onResizeEnd = (event: PointerEvent<HTMLDivElement>) => {
    resizeOrigin.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    onWidthChange(width + (event.key === 'ArrowRight' ? 16 : -16))
  }

  const rootEntries = entriesByPath[workspace.path] ?? []
  const rootLoading = loading.has(workspace.path)
  const rootError = errors[workspace.path]
  return (
    <aside className={'workspace-sidebar' + (embedded ? ' is-embedded' : '')} style={{ width: embedded ? undefined : width, display: collapsed ? 'none' : undefined }} aria-label={t('文件夹工作区')}>
      <div className="workspace-sidebar-header">
        <div className="workspace-sidebar-title" title={workspace.path}>
          <strong>{workspace.displayName}</strong><span>{t('工作区文件')}</span>
        </div>
        <div className="workspace-sidebar-actions">
          <button type="button" className="icon-button compact" onClick={() => setNewFileOpen(value => !value)} aria-label={t('新建 Markdown 文件')} title={t('新建 Markdown 文件')}><FilePlus2 size={15} /></button>
          <button type="button" className="icon-button compact" onClick={() => { void refresh() }} aria-label={t('刷新工作区')} title={t('刷新工作区')} disabled={rootLoading}><RefreshCw className={rootLoading ? 'is-spinning' : ''} size={15} /></button>
          <button type="button" className="icon-button compact" onClick={onChooseWorkspace} aria-label={t('切换工作区')} title={t('切换工作区')}><FolderOpen size={15} /></button>
        </div>
      </div>

      {newFileOpen && <form className="workspace-new-file" onSubmit={event => { void submitNewFile(event) }}>
        <input autoFocus value={newFileName} onChange={event => setNewFileName(event.target.value)} placeholder={t('文件名.md')} aria-label={t('新建 Markdown 文件名')} maxLength={240} />
        <button type="submit" disabled={!newFileName.trim() || creating}>{creating ? <LoaderCircle className="is-spinning" size={14} /> : t('创建')}</button>
        {createError && <span className="workspace-inline-error" role="alert">{createError}</span>}
      </form>}

      {rootError ? <div className="workspace-state is-error" role="alert">
        <AlertCircle size={16} /><span>{t('工作区目录无法访问；目录可能已移动、删除或权限不足。')}</span>
        <button type="button" onClick={() => { void loadDirectory(workspace.path, true) }}>{t('重试')}</button>
      </div> : rootLoading && rootEntries.length === 0 ? <div className="workspace-state" role="status"><LoaderCircle className="is-spinning" size={15} />{t('正在读取目录…')}</div>
        : rootEntries.length === 0 ? <div className="workspace-state" role="status">{t('此文件夹中没有可显示的文档。')}</div>
          : <div className="tree-list" role="tree" aria-label={t('工作区文件')}>
            {rootEntries.map(entry => <TreeEntry key={entry.path} entry={entry} depth={0} activePath={activePath} entriesByPath={entriesByPath} expanded={expanded} loading={loading} errors={errors} truncated={truncated} onToggle={toggleDirectory} onOpen={onOpen} onRetry={path => { void loadDirectory(path, true) }} />)}
          </div>}
      {truncated.has(workspace.path) && <div className="workspace-truncated" role="status">{t('目录项目过多，仅显示前 2000 项。')}</div>}
      {!embedded && <div className="workspace-resize-handle" role="separator" aria-orientation="vertical" aria-label={t('调整工作区宽度')} aria-valuemin={180} aria-valuemax={420} aria-valuenow={width} tabIndex={0} onPointerDown={onResizeStart} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd} onKeyDown={onResizeKeyDown} />}
    </aside>
  )
}

function TreeEntry({ entry, depth, activePath, entriesByPath, expanded, loading, errors, truncated, onToggle, onOpen, onRetry }: {
  entry: WorkspaceEntry
  depth: number
  activePath: string | null
  entriesByPath: Record<string, WorkspaceEntry[]>
  expanded: Set<string>
  loading: Set<string>
  errors: Record<string, string>
  truncated: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onRetry: (path: string) => void
}) {
  const t = useI18n()
  const isExpanded = expanded.has(entry.path)
  const paddingLeft = 9 + depth * 14
  const active = !entry.isDirectory && entry.path === activePath
  if (!entry.isDirectory) return <div role="treeitem" aria-selected={active}>
    <button type="button" className={'tree-row file-row' + (active ? ' is-active' : '')} style={{ paddingLeft: paddingLeft + 18 }} onClick={() => onOpen(entry.path)} title={entry.path}>
      <FileText size={14} /><span>{entry.name}</span>
    </button>
  </div>

  const children = entriesByPath[entry.path] ?? []
  const isLoading = loading.has(entry.path)
  const error = errors[entry.path]
  return <div role="treeitem" aria-expanded={isExpanded}>
    <button type="button" className="tree-row folder-row" style={{ paddingLeft }} onClick={() => onToggle(entry.path)} title={entry.path}>
      {isLoading ? <LoaderCircle className="is-spinning" size={13} /> : isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{entry.name}</span>
    </button>
    {isExpanded && <div role="group">
      {error ? <div className="workspace-child-error" role="status"><span>{t('无法读取此子文件夹。')}</span><button type="button" onClick={() => onRetry(entry.path)}>{t('重试')}</button></div>
        : isLoading && children.length === 0 ? <div className="workspace-child-loading" role="status">{t('正在读取目录…')}</div>
          : children.length === 0 ? <div className="workspace-child-loading" role="status">{t('空文件夹')}</div>
            : children.map(child => <TreeEntry key={child.path} entry={child} depth={depth + 1} activePath={activePath} entriesByPath={entriesByPath} expanded={expanded} loading={loading} errors={errors} truncated={truncated} onToggle={onToggle} onOpen={onOpen} onRetry={onRetry} />)}
      {truncated.has(entry.path) && <div className="workspace-child-loading" role="status">{t('目录项目过多，仅显示前 2000 项。')}</div>}
    </div>}
  </div>
}

function localizeError(t: (value: string) => string, error: string) {
  if (error.startsWith('目标文件已存在：')) return t('目标文件已存在，请使用其他名称。')
  if (error.startsWith('只支持新建')) return t('只能创建 .md 或 .markdown 文件。')
  if (error.includes('权限') || error.includes('访问')) return t('无法写入该工作区目录，请检查权限。')
  return t('无法创建 Markdown 文件，请检查名称和目录权限。')
}
