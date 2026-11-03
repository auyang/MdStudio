import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { confirm, open, save } from '@tauri-apps/plugin-dialog'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Code2,
  Columns2,
  FilePlus2,
  FileText,
  FolderOpen,
  Info,
  Maximize2,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings2,
  Sun,
  X,
} from 'lucide-react'
import logoSymbol from '../assets/brand/logo-symbol.svg'
import { FileTree, type TreeNode } from '../components/sidebar/FileTree'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { extractHeadings, findCompatibilityRisks } from '../features/documents/markdownSafety'
import { imageAsBase64, supportedImage, type PendingImage } from '../features/documents/pendingImages'
import { remapMarkdownImageDestinations } from '../features/documents/markdownImages'
import {
  createSession,
  createUntitledSession,
  markSessionSaved,
  updateSessionContent,
  type DocumentSession,
  type DocumentSnapshot,
  type EditorMode,
} from '../features/documents/session'
import type { EditorView } from '@codemirror/view'

const CodeMirrorEditor = lazy(() => import('../components/editor/CodeMirrorEditor').then(({ CodeMirrorEditor }) => ({ default: CodeMirrorEditor })))
const MilkdownEditor = lazy(() => import('../components/editor/MilkdownEditor').then(({ MilkdownEditor }) => ({ default: MilkdownEditor })))
const MarkdownPreview = lazy(() => import('../components/editor/MarkdownPreview').then(({ MarkdownPreview }) => ({ default: MarkdownPreview })))

interface FileInfo {
  filePath: string
  diskVersionHash: string
  byteSize: number
  modifiedUnixMs: number | null
}

interface VersionCheck {
  changed: boolean
  diskVersionHash: string
}

type Notice = { kind: 'success' | 'error'; text: string }

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function countWords(markdown: string): number {
  const western = markdown.match(/[\p{L}\p{N}_]+/gu) ?? []
  const cjk = markdown.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu) ?? []
  return western.length + cjk.length
}

function initialTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem('mdstudio-theme') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

interface ReadingSettings {
  width: number
  fontSize: number
  lineHeight: number
  font: 'sans' | 'serif'
}

function initialReadingSettings(): ReadingSettings {
  const fallback: ReadingSettings = { width: 790, fontSize: 16, lineHeight: 1.9, font: 'serif' }
  try {
    const value = JSON.parse(localStorage.getItem('mdstudio-reading') ?? '{}') as Partial<ReadingSettings>
    return {
      width: Math.min(1100, Math.max(620, Number(value.width) || fallback.width)),
      fontSize: Math.min(22, Math.max(14, Number(value.fontSize) || fallback.fontSize)),
      lineHeight: Math.min(2.2, Math.max(1.45, Number(value.lineHeight) || fallback.lineHeight)),
      font: value.font === 'sans' ? 'sans' : 'serif',
    }
  } catch {
    return fallback
  }
}

export function App() {
  const [sessions, setSessions] = useState<DocumentSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [leftWidth, setLeftWidth] = useState(252)
  const [rightWidth, setRightWidth] = useState(246)
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme)
  const [reading, setReading] = useState<ReadingSettings>(initialReadingSettings)
  const [focusMode, setFocusMode] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const editorViewRef = useRef<EditorView | null>(null)
  const editorSearchRef = useRef<(() => void) | null>(null)
  const sessionsRef = useRef(sessions)
  const activeIdRef = useRef(activeId)
  const pendingFindRef = useRef(false)
  const pollingRef = useRef(false)
  const pendingImagesRef = useRef(new Map<string, Map<string, PendingImage>>())
  const imageAliasesRef = useRef(new Map<string, Map<string, string>>())
  sessionsRef.current = sessions
  activeIdRef.current = activeId

  const activeSession = sessions.find((session) => session.documentId === activeId) ?? null
  const headings = useMemo(() => activeSession ? extractHeadings(activeSession.currentContent) : [], [activeSession?.currentContent])
  const compatibilityRisks = useMemo(() => activeSession ? findCompatibilityRisks(activeSession.currentContent) : [], [activeSession?.currentContent])
  const canUseVisual = compatibilityRisks.length === 0
  const modifierLabel = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('mdstudio-theme', theme) } catch { /* 私密浏览模式下忽略本地主题写入失败 */ }
  }, [theme])

  useEffect(() => {
    try { localStorage.setItem('mdstudio-reading', JSON.stringify(reading)) } catch { /* 私密浏览模式下忽略本地偏好写入失败 */ }
  }, [reading])

  useEffect(() => () => {
    for (const images of pendingImagesRef.current.values()) for (const image of images.values()) URL.revokeObjectURL(image.previewUrl)
    for (const aliases of imageAliasesRef.current.values()) for (const url of aliases.keys()) URL.revokeObjectURL(url)
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (!sessionsRef.current.some((session) => session.isDirty)) return
      event.preventDefault()
      if (await confirm('仍有未保存的 Markdown 修改。确定退出 MdStudio 吗？', {
        title: 'MdStudio',
        kind: 'warning',
        okLabel: '退出',
        cancelLabel: '继续编辑',
      })) {
        await getCurrentWindow().destroy()
      }
    }).then((release) => { unlisten = release })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 4400)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const setSession = useCallback((documentId: string, update: (session: DocumentSession) => DocumentSession) => {
    setSessions((current) => current.map((session) => session.documentId === documentId ? update(session) : session))
  }, [])

  const showError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    setNotice({ kind: 'error', text: message.replace(/^Error: /, '') })
  }, [])

  const registerImageUpload = useCallback(async (documentId: string, file: File) => {
    const descriptor = supportedImage(file)
    if (!descriptor) throw new Error('图片格式不支持或文件超过 20 MiB。')
    const previewUrl = URL.createObjectURL(file)
    const image: PendingImage = { ...descriptor, id: crypto.randomUUID(), previewUrl }
    const images = pendingImagesRef.current.get(documentId) ?? new Map<string, PendingImage>()
    images.set(previewUrl, image)
    pendingImagesRef.current.set(documentId, images)
    return previewUrl
  }, [])

  const clearDocumentImages = useCallback((documentId: string) => {
    for (const image of pendingImagesRef.current.get(documentId)?.values() ?? []) URL.revokeObjectURL(image.previewUrl)
    for (const url of imageAliasesRef.current.get(documentId)?.keys() ?? []) URL.revokeObjectURL(url)
    pendingImagesRef.current.delete(documentId)
    imageAliasesRef.current.delete(documentId)
  }, [])

  const openPath = useCallback(async (filePath: string) => {
    const existing = sessionsRef.current.find((session) => session.filePath === filePath)
    if (existing) {
      setActiveId(existing.documentId)
      return
    }
    try {
      if (!isTauri()) throw new Error('原生文件操作需要在 MdStudio 桌面程序中使用。')
      const snapshot = await invoke<DocumentSnapshot>('open_document', { filePath })
      const session = createSession(snapshot)
      setSessions((current) => [...current, session])
      setActiveId(session.documentId)
    } catch (error) {
      showError(error)
    }
  }, [showError])

  const openFileDialog = useCallback(async () => {
    try {
      if (!isTauri()) throw new Error('原生文件操作需要在 MdStudio 桌面程序中使用。')
      const selected = await open({
        multiple: false,
        directory: false,
        title: '打开 Markdown 文档',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      })
      if (typeof selected === 'string') await openPath(selected)
    } catch (error) {
      showError(error)
    }
  }, [openPath, showError])

  const refreshWorkspace = useCallback(async (rootPath: string) => {
    const nodes = await invoke<TreeNode[]>('read_workspace_tree', { rootPath })
    setWorkspacePath(rootPath)
    setTree(nodes)
  }, [])

  const openFolderDialog = useCallback(async () => {
    try {
      if (!isTauri()) throw new Error('原生文件操作需要在 MdStudio 桌面程序中使用。')
      const selected = await open({ directory: true, multiple: false, title: '打开工作区' })
      if (typeof selected === 'string') await refreshWorkspace(selected)
    } catch (error) {
      showError(error)
    }
  }, [refreshWorkspace, showError])

  const createDocument = useCallback(() => {
    const session = createUntitledSession()
    setSessions((current) => [...current, session])
    setActiveId(session.documentId)
  }, [])

  const writeSession = useCallback(async (session: DocumentSession, filePath: string, expectedHash: string | null) => {
    const savedRevision = session.revision
    const replacements = new Map<string, string>()
    const uploadedUrls = new Set<string>()
    const pending = pendingImagesRef.current.get(session.documentId)
    let savedContent = session.currentContent
    if (pending) {
      for (const image of pending.values()) {
        if (!savedContent.includes(image.previewUrl)) continue
        const result = await invoke<{ relativePath: string; byteSize: number }>('save_document_asset', {
          filePath,
          assetId: image.id,
          extension: image.extension,
          mimeType: image.mimeType,
          base64Content: await imageAsBase64(image.file),
        })
        replacements.set(image.previewUrl, result.relativePath)
        uploadedUrls.add(image.previewUrl)
      }
    }
    if (replacements.size > 0) savedContent = remapMarkdownImageDestinations(savedContent, replacements)
    const result = await invoke<{ filePath: string; diskVersionHash: string }>('save_document', {
      filePath,
      content: savedContent,
      expectedHash,
      bom: session.bom,
      lineEnding: session.lineEnding,
    })
    if (replacements.size > 0) {
      const aliases = imageAliasesRef.current.get(session.documentId) ?? new Map<string, string>()
      for (const [url, path] of replacements) aliases.set(url, path)
      imageAliasesRef.current.set(session.documentId, aliases)
    }
    setSession(session.documentId, (current) => {
      const currentContent = replacements.size > 0
        ? remapMarkdownImageDestinations(current.currentContent, replacements)
        : current.currentContent
      return markSessionSaved({ ...current, currentContent }, result.filePath, result.diskVersionHash, savedContent, savedRevision)
    })
    if (pending) {
      for (const url of pending.keys()) {
        pending.delete(url)
        if (!uploadedUrls.has(url)) URL.revokeObjectURL(url)
      }
      if (pending.size === 0) pendingImagesRef.current.delete(session.documentId)
    }
    if (workspacePath) {
      try { await refreshWorkspace(workspacePath) } catch { /* 文件已写入，树刷新失败不回滚保存 */ }
    }
    setNotice({ kind: 'success', text: `已保存 ${basename(result.filePath)}` })
  }, [refreshWorkspace, setSession, workspacePath])

  const saveAs = useCallback(async (session: DocumentSession) => {
    try {
      if (!isTauri()) throw new Error('保存文件需要在 MdStudio 桌面程序中使用。')
      const selected = await save({
        defaultPath: session.filePath ?? '未命名.md',
        title: '另存为 Markdown',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      })
      if (!selected) return

      const sameFile = session.filePath === selected
      const exists = await invoke<boolean>('document_exists', { filePath: selected })
      let expectedHash = sameFile ? session.diskVersionHash : null
      if (exists && !sameFile) {
        const replace = await confirm(`“${basename(selected)}”已经存在。确定替换这个文件吗？`, {
          title: 'MdStudio',
          kind: 'warning',
          okLabel: '替换',
          cancelLabel: '取消',
        })
        if (!replace) return
        const info = await invoke<FileInfo>('get_file_info', { filePath: selected })
        expectedHash = info.diskVersionHash
      }
      await writeSession(session, selected, expectedHash)
    } catch (error) {
      showError(error)
    }
  }, [showError, writeSession])

  const saveActive = useCallback(async (forceSaveAs = false) => {
    const session = sessionsRef.current.find((item) => item.documentId === activeIdRef.current)
    if (!session) return
    if (forceSaveAs || !session.filePath) {
      await saveAs(session)
      return
    }
    if (!session.isDirty) {
      setNotice({ kind: 'success', text: `已保存 ${basename(session.filePath)}` })
      return
    }
    try {
      await writeSession(session, session.filePath, session.diskVersionHash)
    } catch (error) {
      showError(error)
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('文件已在磁盘上发生变化')) {
        setSession(session.documentId, (current) => ({ ...current, diskConflict: true }))
      }
    }
  }, [saveAs, setSession, showError, writeSession])

  const closeTab = useCallback(async (documentId: string) => {
    const session = sessionsRef.current.find((item) => item.documentId === documentId)
    if (!session) return
    if (session.isDirty && !await confirm(`“${session.filePath ? basename(session.filePath) : '未命名.md'}”有未保存的修改。仍要关闭吗？`, {
      title: 'MdStudio',
      kind: 'warning',
      okLabel: '关闭文档',
      cancelLabel: '继续编辑',
    })) return
    const current = sessionsRef.current
    const index = current.findIndex((item) => item.documentId === documentId)
    const remaining = current.filter((item) => item.documentId !== documentId)
    setSessions(remaining)
    clearDocumentImages(documentId)
    if (activeIdRef.current === documentId) {
      setActiveId(remaining[Math.min(index, remaining.length - 1)]?.documentId ?? null)
    }
  }, [clearDocumentImages])

  const changeContent = useCallback((documentId: string, content: string) => {
    setSession(documentId, (session) => updateSessionContent(session, content))
  }, [setSession])

  const changeMode = useCallback((session: DocumentSession, mode: EditorMode) => {
    if (mode === 'visual' && findCompatibilityRisks(session.currentContent).length > 0) {
      setSession(session.documentId, (current) => ({ ...current, activeMode: 'source' }))
      setNotice({ kind: 'error', text: '此文档含有源码扩展，P1 为保护原文已停用所见即所得。请继续使用源码或分栏模式。' })
      return
    }
    setSession(session.documentId, (current) => ({ ...current, activeMode: mode }))
  }, [setSession])

  const findInDocument = useCallback(() => {
    if (editorSearchRef.current) {
      editorSearchRef.current()
      return
    }
    pendingFindRef.current = true
    const session = sessionsRef.current.find((item) => item.documentId === activeIdRef.current)
    if (session) changeMode(session, 'source')
    else setNotice({ kind: 'error', text: '请先打开或新建 Markdown 文档。' })
  }, [changeMode])

  const handleEditorView = useCallback((view: EditorView | null) => {
    editorViewRef.current = view
  }, [])

  const handleEditorSearch = useCallback((search: (() => void) | null) => {
    editorSearchRef.current = search
    if (search && pendingFindRef.current) {
      pendingFindRef.current = false
      window.setTimeout(search, 60)
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier || event.defaultPrevented) return
      const target = event.target
      const element = target instanceof HTMLElement ? target : null
      const isTextField = element && ['INPUT', 'TEXTAREA'].includes(element.tagName)
      const isCodeMirror = element?.closest('.cm-content') !== null && element !== null
      if ((isTextField || isCodeMirror) && event.key.toLowerCase() === 'f') return
      const key = event.key.toLowerCase()
      if (key === 'o' && !event.shiftKey) {
        event.preventDefault()
        void openFileDialog()
      } else if (key === 'n' && !event.shiftKey) {
        event.preventDefault()
        createDocument()
      } else if (key === 's' && event.shiftKey) {
        event.preventDefault()
        void saveActive(true)
      } else if (key === 's') {
        event.preventDefault()
        void saveActive()
      } else if (key === 'f') {
        event.preventDefault()
        findInDocument()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createDocument, findInDocument, openFileDialog, saveActive])

  useEffect(() => {
    if (!activeSession?.filePath || !activeSession.diskVersionHash) return
    const { filePath, diskVersionHash, documentId } = activeSession
    const timer = window.setInterval(async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      try {
        const check = await invoke<VersionCheck>('check_document_version', { filePath, expectedHash: diskVersionHash })
        if (!check.changed) return
        const latestSession = sessionsRef.current.find((item) => item.documentId === documentId)
        if (!latestSession) return
        if (latestSession.isDirty) {
          setSession(documentId, (current) => ({ ...current, diskConflict: true }))
          return
        }
        const latest = await invoke<DocumentSnapshot>('open_document', { filePath })
        setSession(documentId, (current) => current.isDirty ? { ...current, diskConflict: true } : {
          ...current,
          originalContent: latest.content,
          currentContent: latest.content,
          diskVersionHash: latest.diskVersionHash,
          bom: latest.bom,
          lineEnding: latest.lineEnding,
          revision: current.revision + 1,
          diskConflict: false,
        })
        setNotice({ kind: 'success', text: `已载入外部更新：${basename(filePath)}` })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('不存在')) setSession(documentId, (current) => ({ ...current, diskConflict: true }))
      } finally {
        pollingRef.current = false
      }
    }, 3500)
    return () => window.clearInterval(timer)
  }, [activeSession?.documentId, activeSession?.diskVersionHash, activeSession?.filePath, activeSession?.isDirty, setSession])

  const reloadFromDisk = useCallback(async (session: DocumentSession) => {
    if (session.isDirty && !await confirm('放弃本地未保存内容并载入磁盘版本？', {
      title: 'MdStudio',
      kind: 'warning',
      okLabel: '载入磁盘版本',
      cancelLabel: '继续编辑',
    })) return
    if (!session.filePath) return
    try {
      const latest = await invoke<DocumentSnapshot>('open_document', { filePath: session.filePath })
      setSession(session.documentId, (current) => ({
        ...current,
        originalContent: latest.content,
        currentContent: latest.content,
        diskVersionHash: latest.diskVersionHash,
        bom: latest.bom,
        lineEnding: latest.lineEnding,
        isDirty: false,
        diskConflict: false,
        revision: current.revision + 1,
      }))
    } catch (error) {
      showError(error)
    }
  }, [setSession, showError])

  const resizePanel = useCallback((side: 'left' | 'right', event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startingWidth = side === 'left' ? leftWidth : rightWidth
    setIsResizing(true)
    const onMove = (move: MouseEvent) => {
      const delta = move.clientX - startX
      if (side === 'left') setLeftWidth(Math.min(420, Math.max(190, startingWidth + delta)))
      else setRightWidth(Math.min(380, Math.max(190, startingWidth - delta)))
    }
    const onUp = () => {
      setIsResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [leftWidth, rightWidth])

  const jumpToHeading = useCallback((headingIndex: number) => {
    if (!activeSession) return
    const heading = headings[headingIndex]
    if (!heading) return
    if (activeSession.activeMode === 'source' && editorViewRef.current) {
      const line = activeSession.currentContent.slice(0, heading.index).split('\n').length - 1
      const lineInfo = editorViewRef.current.state.doc.line(Math.min(line + 1, editorViewRef.current.state.doc.lines))
      editorViewRef.current.dispatch({
        selection: { anchor: lineInfo.from },
        scrollIntoView: true,
      })
      editorViewRef.current.focus()
      return
    }
    const container = document.querySelector(activeSession.activeMode === 'split' ? '.preview-pane' : '.visual-pane')
    const candidates = Array.from(container?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])
    const target = candidates.find((element) => element.textContent?.trim() === heading.text)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeSession, headings])

  const saveLabel = activeSession?.isDirty ? '未保存' : activeSession?.filePath ? `已保存${activeSession.lastSavedAt ? ` · ${new Date(activeSession.lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}` : '新文档'
  const title = activeSession?.filePath ? basename(activeSession.filePath) : '未命名.md'
  const imageUrlReplacements = activeSession
    ? Object.fromEntries(imageAliasesRef.current.get(activeSession.documentId) ?? [])
    : {}
  const readingStyle = {
    '--reading-width': `${reading.width}px`,
    '--reading-font-size': `${reading.fontSize}px`,
    '--reading-line-height': reading.lineHeight,
    '--reading-font-family': reading.font === 'serif'
      ? '"Iowan Old Style", "Songti SC", "Noto Serif CJK SC", serif'
      : '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  } as CSSProperties

  return (
    <main className={`app-shell${isResizing ? ' is-resizing' : ''}${focusMode && activeSession ? ' is-focus-mode' : ''}`} style={readingStyle}>
      <header className="topbar">
        <div className="brand-cluster">
          <img className="brand-symbol" src={logoSymbol} alt="" />
          <span className="brand-name">MdStudio</span>
          <span className="brand-version">0.1</span>
        </div>

        <div className="topbar-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="topbar-menu-button" aria-label="打开文件菜单"><Menu size={15} /> 文件 <ChevronDown size={12} /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={createDocument}><FilePlus2 size={15} />新建文档<span className="menu-shortcut">{modifierLabel}N</span></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void openFileDialog()}><FileText size={15} />打开文件<span className="menu-shortcut">{modifierLabel}O</span></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void openFolderDialog()}><FolderOpen size={15} />打开文件夹</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void saveActive()}><Check size={15} />保存<span className="menu-shortcut">{modifierLabel}S</span></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void saveActive(true)}><FilePlus2 size={15} />另存为<span className="menu-shortcut">⇧{modifierLabel}S</span></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="topbar-context">本地 Markdown 工作台</span>
        </div>

        <div className="topbar-actions">
          <button className="icon-button search-button" onClick={findInDocument} title={`查找 · ${modifierLabel}F`}><Search size={16} /><span>查找</span><kbd>{modifierLabel}F</kbd></button>
          <button className="icon-button" onClick={() => setTheme((value) => value === 'light' ? 'dark' : 'light')} title={theme === 'light' ? '切换深色主题' : '切换浅色主题'}>
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="icon-button" title="设置"><Settings2 size={16} /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="settings-menu">
              <div className="settings-heading">MdStudio v0.1.0</div>
              <div className="settings-line"><span>存储方式</span><strong>仅本地文件</strong></div>
              <div className="settings-line"><span>自动保存</span><strong>关闭</strong></div>
              <div className="settings-line"><span>当前阶段</span><strong>P2 高级编辑</strong></div>
              <label className="reading-setting"><span>正文宽度 <b>{reading.width}px</b></span><input aria-label="正文宽度" type="range" min="620" max="1100" step="10" value={reading.width} onChange={(event) => setReading((value) => ({ ...value, width: Number(event.target.value) }))} /></label>
              <label className="reading-setting"><span>字号 <b>{reading.fontSize}px</b></span><input aria-label="正文大小" type="range" min="14" max="22" step="1" value={reading.fontSize} onChange={(event) => setReading((value) => ({ ...value, fontSize: Number(event.target.value) }))} /></label>
              <label className="reading-setting"><span>行距 <b>{reading.lineHeight.toFixed(2)}</b></span><input aria-label="正文行距" type="range" min="1.45" max="2.2" step="0.05" value={reading.lineHeight} onChange={(event) => setReading((value) => ({ ...value, lineHeight: Number(event.target.value) }))} /></label>
              <label className="reading-setting"><span>字体</span><select aria-label="正文字体" value={reading.font} onChange={(event) => setReading((value) => ({ ...value, font: event.target.value === 'sans' ? 'sans' : 'serif' }))}><option value="serif">衬线</option><option value="sans">无衬线</option></select></label>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setShowAbout(true)}><Info size={15} />关于 MdStudio</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <section className="workspace-frame">
        {leftOpen && (
          <aside className="sidebar left-sidebar" style={{ width: leftWidth }}>
            <div className="sidebar-heading">
              <div><span className="eyebrow">WORKSPACE</span><strong title={workspacePath ?? undefined}>{workspacePath ? basename(workspacePath) : '文档'}</strong></div>
              <div className="sidebar-tools">
                <button className="small-icon-button" onClick={createDocument} title="新建文档"><FilePlus2 size={15} /></button>
                <button className="small-icon-button" onClick={() => void openFolderDialog()} title="打开工作区"><FolderOpen size={15} /></button>
                <button className="small-icon-button subtle" onClick={() => setLeftOpen(false)} title="折叠文件栏"><PanelLeftClose size={15} /></button>
              </div>
            </div>
            {workspacePath ? (
              <div className="workspace-tree">
                {tree.length > 0
                  ? <FileTree nodes={tree} activePath={activeSession?.filePath ?? null} onOpen={(path) => void openPath(path)} />
                  : <div className="empty-tree">此文件夹中没有 Markdown 文件</div>}
              </div>
            ) : (
              <div className="sidebar-empty">
                <div className="empty-glyph"><FolderOpen size={19} /></div>
                <p>打开一个文件夹</p>
                <span>在左侧浏览你的 Markdown 文档</span>
                <button className="text-action" onClick={() => void openFolderDialog()}>选择工作区 <span>↗</span></button>
              </div>
            )}
            <div className="sidebar-footer"><span className="local-dot" />文件保存在你的设备上</div>
          </aside>
        )}
        {leftOpen && <div className="resize-rail" onMouseDown={(event) => resizePanel('left', event)} aria-hidden="true" />}

        <section className="editor-column">
          <div className="tabbar">
            <div className="tab-scroll" role="tablist" aria-label="打开的文档">
              {sessions.map((session) => {
                const selected = session.documentId === activeId
                const tabName = session.filePath ? basename(session.filePath) : '未命名.md'
                return (
                  <div className={`document-tab ${selected ? 'is-selected' : ''}`} role="presentation" key={session.documentId}>
                    <button role="tab" aria-selected={selected} className="tab-title" onClick={() => setActiveId(session.documentId)} title={session.filePath ?? tabName}>
                      {session.isDirty && <span className="dirty-dot" />}
                      <span>{tabName}</span>
                    </button>
                    <button className="tab-close" onClick={() => closeTab(session.documentId)} aria-label={`关闭 ${tabName}`}><X size={13} /></button>
                  </div>
                )
              })}
              {sessions.length > 0 && <button className="new-tab-button" onClick={createDocument} title="新建文档"><FilePlus2 size={15} /></button>}
            </div>
            {activeSession && (
              <div className="document-crumb"><span>{workspacePath && activeSession.filePath?.startsWith(workspacePath) ? basename(workspacePath) : 'Markdown'}</span><span className="crumb-separator">/</span><strong>{title}</strong></div>
            )}
          </div>

          {activeSession ? (
            <>
              <div className="editor-toolbar">
                <div className="toolbar-left">
                  {!leftOpen && <button className="small-icon-button toolbar-restore" onClick={() => setLeftOpen(true)} title="展开文件栏"><PanelLeftOpen size={16} /></button>}
                  <span className="editor-file-name">{title}{activeSession.isDirty && <i />}</span>
                  {compatibilityRisks.length > 0 && <span className="compat-pill" title={`原文包含：${compatibilityRisks.map((risk) => risk.label).join('、')}`}><AlertTriangle size={12} />源码扩展</span>}
                </div>
                <div className="mode-switch" role="group" aria-label="编辑模式">
                  <button className={activeSession.activeMode === 'visual' ? 'is-active' : ''} onClick={() => changeMode(activeSession, 'visual')} disabled={!canUseVisual} title={!canUseVisual ? '文档含源码扩展，已禁用可视化模式以保护原文' : '所见即所得'}><span className="mode-icon mode-eye">◉</span>可视化</button>
                  <button className={activeSession.activeMode === 'source' ? 'is-active' : ''} onClick={() => changeMode(activeSession, 'source')} title="Markdown 源码"><Code2 size={13} />源码</button>
                  <button className={activeSession.activeMode === 'split' ? 'is-active' : ''} onClick={() => changeMode(activeSession, 'split')} title="源码与实时预览"><Columns2 size={14} />分栏</button>
                </div>
                <div className="toolbar-right">
                  <button className={`small-icon-button toolbar-restore${focusMode ? ' is-active' : ''}`} onClick={() => setFocusMode((value) => !value)} title={focusMode ? '退出专注模式' : '专注模式'} aria-label={focusMode ? '退出专注模式' : '专注模式'}><Maximize2 size={15} /></button>
                  <button className="small-icon-button toolbar-restore" onClick={() => setRightOpen((value) => !value)} title={rightOpen ? '折叠大纲' : '展开大纲'}>
                    {rightOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                  </button>
                  <button className="save-button" onClick={() => void saveActive()} title="保存文档"><Check size={13} />保存</button>
                </div>
              </div>

              {activeSession.diskConflict && (
                <div className="conflict-banner" role="alert">
                  <AlertTriangle size={16} />
                  <span>磁盘文件已被外部修改。当前内容仍保留在此标签中，保存会被阻止。</span>
                  <button onClick={() => void reloadFromDisk(activeSession)}>载入磁盘版本</button>
                  <button onClick={() => void saveActive(true)}>另存为</button>
                </div>
              )}

              {compatibilityRisks.length > 0 && activeSession.activeMode === 'visual' ? (
                <div className="safety-screen">
                  <div className="safety-card">
                    <div className="safety-icon"><AlertTriangle size={20} /></div>
                    <span className="eyebrow">原文保护</span>
                    <h1>此文档包含源码扩展</h1>
                    <p>当前可视化编辑器不能保证保留 {compatibilityRisks.map((risk) => risk.label).join('、')}。MdStudio 已保留原始 Markdown，请在源码模式或分栏模式中继续编辑。</p>
                    <button className="primary-button" onClick={() => changeMode(activeSession, 'source')}><Code2 size={15} />使用源码编辑</button>
                  </div>
                </div>
              ) : (
                <div className={`editor-stage mode-${activeSession.activeMode}`}>
                  {activeSession.activeMode === 'visual' && (
                    <div className="visual-pane">
                      <Suspense fallback={<div className="editor-loading">正在加载所见即所得编辑器…</div>}>
                        <MilkdownEditor
                          key={activeSession.documentId}
                          documentId={activeSession.documentId}
                          filePath={activeSession.filePath}
                          initialContent={activeSession.currentContent}
                          imageUrlReplacements={imageUrlReplacements}
                          onImageUpload={(file) => registerImageUpload(activeSession.documentId, file)}
                          onImageError={(message) => setNotice({ kind: 'error', text: message })}
                          onChange={(content) => changeContent(activeSession.documentId, content)}
                        />
                      </Suspense>
                    </div>
                  )}
                  {activeSession.activeMode === 'source' && (
                    <div className="source-pane">
                      <Suspense fallback={<div className="editor-loading">正在加载源码编辑器…</div>}>
                        <CodeMirrorEditor
                          key={activeSession.documentId}
                          value={activeSession.currentContent}
                          theme={theme}
                          onChange={(content) => changeContent(activeSession.documentId, content)}
                          onViewReady={handleEditorView}
                          onSearchReady={handleEditorSearch}
                        />
                      </Suspense>
                    </div>
                  )}
                  {activeSession.activeMode === 'split' && (
                    <div className="split-panes">
                      <div className="source-pane split-source-pane">
                        <div className="pane-label">MARKDOWN</div>
                        <Suspense fallback={<div className="editor-loading">正在加载源码编辑器…</div>}>
                          <CodeMirrorEditor
                            key={activeSession.documentId}
                            value={activeSession.currentContent}
                            theme={theme}
                            onChange={(content) => changeContent(activeSession.documentId, content)}
                            onViewReady={handleEditorView}
                            onSearchReady={handleEditorSearch}
                          />
                        </Suspense>
                      </div>
                      <div className="split-divider" />
                      <div className="preview-pane">
                        <div className="pane-label">预览 <span>实时</span></div>
                        <Suspense fallback={<div className="editor-loading">正在加载预览组件…</div>}>
                          <MarkdownPreview session={activeSession} />
                        </Suspense>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="welcome-screen">
              <div className="welcome-orbit orbit-one" /><div className="welcome-orbit orbit-two" />
              <div className="welcome-content">
                <img className="welcome-brand-symbol" src={logoSymbol} alt="" />
                <div className="eyebrow">AI 时代的 Markdown 编辑工作台</div>
                <h1>MdStudio</h1>
                <div className="brand-tagline">Write · Read · Create with AI</div>
                <p>一个本地优先的 Markdown 工作台。<br />文件归你所有，写作不必被打断。</p>
                <div className="welcome-actions">
                  <button className="primary-button" onClick={createDocument}><FilePlus2 size={15} />新建文档</button>
                  <button className="secondary-button" onClick={() => void openFileDialog()}><FileText size={15} />打开 Markdown</button>
                </div>
                <div className="welcome-shortcuts"><kbd>{modifierLabel} N</kbd><span>新建</span><kbd>{modifierLabel} O</kbd><span>打开</span><kbd>{modifierLabel} S</kbd><span>保存</span></div>
              </div>
              <div className="welcome-footer"><span><span className="local-dot" />本地文件 · 离线可用</span><span>v0.1.0 · P2</span></div>
            </div>
          )}

          {activeSession && (
            <footer className="statusbar">
              <div className="status-left"><span className={activeSession.isDirty ? 'status-dirty' : 'status-clean'}>{activeSession.isDirty ? <span className="dirty-dot" /> : <Check size={12} />}{saveLabel}</span><span className="status-separator" /><span>Markdown</span><span className="status-separator" /><span>UTF-8{activeSession.bom ? ' BOM' : ''}</span><span>{activeSession.lineEnding.toUpperCase()}</span></div>
              <div className="status-right"><span>{countWords(activeSession.currentContent)} 字</span><span>{activeSession.currentContent.split('\n').length} 行</span><span>MD</span></div>
            </footer>
          )}
        </section>

        {rightOpen && activeSession && (
          <>
            <div className="resize-rail right-rail" onMouseDown={(event) => resizePanel('right', event)} aria-hidden="true" />
            <aside className="sidebar outline-sidebar" style={{ width: rightWidth }}>
              <div className="sidebar-heading outline-heading">
                <div><span className="eyebrow">DOCUMENT MAP</span><strong>文档大纲</strong></div>
                <button className="small-icon-button subtle" onClick={() => setRightOpen(false)} title="折叠大纲"><PanelRightClose size={15} /></button>
              </div>
              {headings.length > 0 ? (
                <nav className="outline-list" aria-label="文档大纲">
                  {headings.map((heading, index) => (
                    <button key={`${heading.index}-${heading.text}`} className={`outline-item level-${heading.level}`} onClick={() => jumpToHeading(index)} title={heading.text}>
                      <span className="outline-marker">{heading.level === 1 ? '—' : '#'}</span><span>{heading.text}</span>
                    </button>
                  ))}
                </nav>
              ) : (
                <div className="outline-empty"><span className="outline-empty-mark">H</span><p>暂无标题</p><span>添加 Markdown 标题后<br />会显示在这里</span></div>
              )}
              <div className="outline-footer"><span>{headings.length}</span> 个标题</div>
            </aside>
          </>
        )}
        {!rightOpen && activeSession && <button className="collapsed-outline-button" onClick={() => setRightOpen(true)} title="展开大纲"><PanelRightOpen size={16} /></button>}
      </section>

      {showAbout && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAbout(false) }}>
          <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
            <button className="dialog-close" onClick={() => setShowAbout(false)} aria-label="关闭关于页面"><X size={16} /></button>
            <img src={logoSymbol} alt="" />
            <span className="eyebrow">AI 时代的 Markdown 编辑工作台</span>
            <h2 id="about-title">MdStudio</h2>
            <p>本地优先的 Markdown 编辑工作台。文档由你掌控，图片资源与文档保存在同一设备。</p>
            <div className="about-meta"><span>版本</span><strong>0.1.0</strong><span>编辑器</span><strong>Milkdown · CodeMirror</strong><span>当前阶段</span><strong>P2 高级 Markdown 编辑</strong></div>
            <button className="primary-button" onClick={() => setShowAbout(false)}>完成</button>
          </section>
        </div>
      )}
      {notice && <div className={`toast toast-${notice.kind}`} role="status">{notice.kind === 'error' ? <AlertTriangle size={15} /> : <Check size={15} />}{notice.text}<button onClick={() => setNotice(null)} aria-label="关闭提示"><X size={13} /></button></div>}
    </main>
  )
}
