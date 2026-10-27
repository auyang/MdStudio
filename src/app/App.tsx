import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  AlertCircle, BookOpen, Check, FileText, FolderOpen, LoaderCircle, RefreshCw,
  X, ZoomIn, ZoomOut,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import logoLight from '../assets/brand/logo-horizontal-light.svg'
import logoDark from '../assets/brand/logo-horizontal-dark.svg'
import logoSymbol from '../assets/brand/logo-symbol.svg'
import { AppHeader } from '../components/layout/AppHeader'
import { ReadingWidthPicker } from '../components/layout/ReadingWidthPicker'
import { MediaViewerDialog } from '../components/reader/MediaViewer'
import type { MediaViewerContent } from '../components/reader/MediaViewer'
import { SettingsDialog } from '../components/reader/SettingsDialog'
import type { SettingsSection } from '../components/reader/SettingsDialog'
import { SearchHighlightCanvas } from '../components/reader/SearchHighlightCanvas'
import { DEFAULT_APP_LOCALE, I18nProvider, translate } from '../features/i18n'
import type { AppLocale } from '../features/reader/preferences'
import { nextHtmlBlockEnd } from '../features/reader/htmlChunker'
import {
  applyCssSearchHighlights,
  clearCssSearchHighlights,
  findDocumentTextMatches,
  firstRangeRect,
  supportsCssCustomHighlights,
} from '../features/reader/documentSearch'
import type { DocumentSearchMatch } from '../features/reader/documentSearch'
import {
  activateReaderTab,
  addOrActivateTab,
  closeReaderTab,
  emptyReaderTabs,
  updateReaderTab,
} from '../features/reader/tabs'
import type { ReaderReadingState, ReaderTab, ReaderTabsState } from '../features/reader/tabs'
import {
  clearReadingPositions,
  clearRecentFiles,
  clearSessionState,
  loadReaderPersistence,
  recordRecentFile,
  READER_STORAGE_KEYS,
  removeRecentFile,
  saveReaderSettings,
  saveReadingPositions,
  saveRecentFiles,
  saveSessionState,
  READING_WIDTH_PX,
} from '../features/reader/preferences'
import type {
  ReaderSettingsV1,
  ReadingPositionV1,
  ReadingPositionsV1,
  RecentFileV1,
  StorageLike,
} from '../features/reader/preferences'
import {
  emptyNavigationHistory,
  moveNavigation,
  recordNavigation,
} from '../features/reader/navigation'
import type { NavigationHistory, ReadingLocation } from '../features/reader/navigation'
import { performanceEnabled, performancePageStart, recordPerformance } from '../features/reader/performance'

type Heading = { id: string; text: string; level: number }
type MermaidDiagramData = { index: number; language: string; source: string }
type ReaderImageAsset = { index: number; size: number; width: number | null; height: number | null }
type ReaderPerformanceTimings = {
  readMs: number
  normalizeMs: number
  parseMs: number
  astExtractMs: number
  renderHtmlMs: number
  sanitizeMs: number
  totalMs: number
}
type ReaderDocument = {
  filePath: string
  fileName: string
  html: string
  headings: Heading[]
  mermaidDiagrams: MermaidDiagramData[]
  imageToken: string
  imageAssets: ReaderImageAsset[]
  missingResources: string[]
  byteSize: number
  modifiedUnixMs: number | null
  performance?: ReaderPerformanceTimings
}
type FileChangeEvent = { paths: string[]; operation: string }
type ReaderTabState = ReaderTab<ReaderDocument>
type DeferredOpen = { paths: string[]; source: string; anchor?: string }
type HeadingElements = HTMLElement[] | null

let nextPerformanceDocumentId = 0

const EMPTY_READING_STATE: ReaderReadingState = {
  scrollTop: 0,
  scrollRatio: 0,
  searchOpen: false,
  searchQuery: '',
  searchMatchIndex: 0,
  searchMatchCount: 0,
  tocOpen: false,
}
const TOC_ROW_HEIGHT = 30
const TOC_VIRTUAL_THRESHOLD = 500
const TOC_VISIBLE_ROWS = 40

function pathFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path
}

function findHeadingAtPosition(
  headings: HeadingElements,
  article: HTMLElement | null,
  position: number,
): HTMLElement | undefined {
  if (!headings?.length || !article) return undefined
  let low = 0
  let high = headings.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const heading = headings[middle]
    if (!heading || !article.contains(heading)) return undefined
    const headingTop = heading.getBoundingClientRect().top + window.scrollY
    if (headingTop <= position) low = middle + 1
    else high = middle
  }
  return low > 0 ? headings[low - 1] : undefined
}

function decodeAnchor(anchor: string): string {
  try { return decodeURIComponent(anchor) } catch { return anchor }
}

function resolveHeadingId(headings: Heading[], anchor: string): string | undefined {
  const decoded = decodeAnchor(anchor.replace(/^#/, ''))
  return headings.find(heading => heading.id === decoded || heading.id === `mdstudio-${decoded}`)?.id
    ?? headings.find(heading => heading.id.toLocaleLowerCase() === decoded.toLocaleLowerCase())?.id
}

const ZOOM_STORAGE_KEY = READER_STORAGE_KEYS.legacyZoom
const MermaidDiagram = lazy(() => import('../components/reader/MermaidDiagram').then(({ MermaidDiagram }) => ({ default: MermaidDiagram })))

const unavailableStorage: StorageLike = {
  getItem: () => { throw new Error('本地存储不可用') },
  setItem: () => { throw new Error('本地存储不可用') },
  removeItem: () => { throw new Error('本地存储不可用') },
}

function getLocalStorage(): StorageLike | null {
  try { return window.localStorage } catch { return null }
}

function loadInitialPersistence() {
  return loadReaderPersistence(getLocalStorage() ?? unavailableStorage)
}

function maxScrollTop(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
}

function captureReadingPosition(path: string, headingId?: string): ReadingPositionV1 {
  const maximum = maxScrollTop()
  return {
    path,
    headingId,
    scrollRatio: maximum > 0 ? Math.min(1, Math.max(0, window.scrollY / maximum)) : 0,
    scrollTop: Math.max(0, window.scrollY),
    updatedAt: Date.now(),
  }
}

function mergePosition(
  positions: ReadingPositionsV1,
  position: ReadingPositionV1,
): ReadingPositionsV1 {
  const items = { ...positions.items, [position.path]: position }
  const limited = Object.fromEntries(Object.entries(items)
    .sort(([, first], [, second]) => second.updatedAt - first.updatedAt)
    .slice(0, 200))
  return { schemaVersion: 1, items: limited }
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function readZoom(): number {
  try {
    const stored = Number(localStorage.getItem(ZOOM_STORAGE_KEY))
    return Number.isFinite(stored) && stored >= 85 && stored <= 140 ? stored : 100
  } catch {
    return 100
  }
}

function displayHtml(
  html: string,
  mermaidCount: number,
  imageAssets: ReaderImageAsset[],
  imageToken: string,
): string {
  if (mermaidCount === 0 && !/<img\b/i.test(html)) {
    const codeCopyButton = '<button type="button" class="reader-code-copy" data-copy-code="true" data-reader-i18n="copy-code" aria-label="复制代码" title="复制代码">复制</button>'
    return html.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi, (block, attributes: string, content: string) =>
      /<code\b/i.test(content) ? `<pre${attributes}>${content}${codeCopyButton}</pre>` : block,
    )
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const imagesByIndex = new Map(imageAssets.map(asset => [asset.index, asset]))
  const anchors = new Map<HTMLAnchorElement, HTMLSpanElement>()
  for (const image of Array.from(parsed.querySelectorAll('img'))) {
    const imageSource = image.getAttribute('src') || ''
    const resourceMatch = imageSource.match(/^mdstudio-image:\/\/asset\/(\d+)$/)
    let hasLocalAsset = false
    if (resourceMatch) {
      const asset = imagesByIndex.get(Number(resourceMatch[1]))
      if (asset && imageToken) {
        hasLocalAsset = true
        image.removeAttribute('src')
        image.dataset.readerImageIndex = String(asset.index)
        image.dataset.readerImageToken = imageToken
        if (asset.width && asset.height) {
          image.width = asset.width
          image.height = asset.height
        }
      } else {
        image.removeAttribute('src')
      }
    }
    if (!hasLocalAsset && !image.getAttribute('src')) {
      const placeholder = parsed.createElement('span')
      placeholder.className = 'reader-missing-image'
      placeholder.dataset.readerI18n = 'image-missing'
      placeholder.dataset.readerImageAlt = image.getAttribute('alt') || ''
      placeholder.textContent = '图片无法显示：' + (image.getAttribute('alt') || '本地图片资源')
      image.replaceWith(placeholder)
      continue
    }

    image.loading = 'lazy'
    image.decoding = 'async'
    image.draggable = false
    image.dataset.readerImage = 'true'
    image.hidden = true
    const alt = image.getAttribute('alt') || ''
    const anchor = image.closest('a')
    const placeholder = parsed.createElement('span')
    placeholder.className = 'reader-image-pending'
    placeholder.setAttribute('role', 'status')
    placeholder.dataset.readerI18n = 'image-loading'
    placeholder.textContent = '正在加载图片…'
    if (image.width > 0 && image.height > 0) {
      placeholder.style.aspectRatio = `${image.width} / ${image.height}`
    }
    let frame: HTMLSpanElement
    if (anchor) {
      frame = anchors.get(anchor) ?? parsed.createElement('span')
      if (!anchors.has(anchor)) {
        frame.className = 'reader-image-frame is-linked'
        anchor.parentElement?.insertBefore(frame, anchor)
        frame.append(anchor)
        anchors.set(anchor, frame)
      }
      anchor.insertBefore(placeholder, image)
    } else {
      frame = parsed.createElement('span')
      frame.className = 'reader-image-frame'
      image.parentElement?.insertBefore(frame, image)
      const trigger = parsed.createElement('button')
      trigger.type = 'button'
      trigger.className = 'reader-image-trigger'
      trigger.dataset.readerImageViewer = 'true'
      trigger.dataset.readerI18n = 'image-viewer'
      trigger.dataset.readerImageAlt = alt
      trigger.setAttribute('aria-label', alt ? `放大查看图片：${alt}` : '放大查看图片')
      trigger.title = '放大查看图片'
      trigger.append(placeholder, image)
      frame.append(trigger)
    }

    if (anchor) {
      const button = parsed.createElement('button')
      button.type = 'button'
      button.className = 'reader-image-zoom'
      button.dataset.readerImageViewer = 'true'
      button.dataset.imageIndex = image.dataset.readerImageIndex || ''
      button.dataset.imageAlt = alt
      button.dataset.readerI18n = 'image-zoom'
      button.setAttribute('aria-label', alt ? `放大查看图片：${alt}` : '放大查看图片')
      button.title = '放大查看图片'
      button.textContent = '放大查看'
      frame.append(button)
    }
  }
  let mermaidIndex = 0
  for (const pre of parsed.querySelectorAll('pre')) {
    const code = pre.querySelector('code')
    if (!code) continue
    if (code.classList.contains('language-mermaid') && mermaidIndex < mermaidCount) {
      const host = parsed.createElement('div')
      host.className = 'reader-mermaid-host'
      host.dataset.mermaidIndex = String(mermaidIndex)
      mermaidIndex += 1
      pre.replaceWith(host)
      continue
    }
    const button = parsed.createElement('button')
    button.type = 'button'
    button.className = 'reader-code-copy'
    button.dataset.copyCode = 'true'
    button.dataset.readerI18n = 'copy-code'
    button.setAttribute('aria-label', '复制代码')
    button.title = '复制代码'
    button.textContent = '复制'
    pre.append(button)
  }
  return parsed.body.innerHTML
}

function localizeReaderArticle(article: HTMLElement, locale: AppLocale) {
  const t = (source: string, values?: Record<string, string | number>) => translate(locale, source, values)
  for (const element of Array.from(article.querySelectorAll<HTMLElement>('[data-reader-i18n]'))) {
    const kind = element.dataset.readerI18n
    if (kind === 'copy-code') {
      element.textContent = t('复制')
      element.setAttribute('aria-label', t('复制代码'))
      element.setAttribute('title', t('复制代码'))
    } else if (kind === 'image-loading') {
      element.textContent = t(element.classList.contains('is-error') ? '图片加载失败：{reason}' : '正在加载图片…', {
        reason: element.dataset.readerErrorReason ?? '',
      })
    } else if (kind === 'image-lazy') {
      element.textContent = t('图片位于视口附近时加载')
    } else if (kind === 'image-missing') {
      element.textContent = t('图片无法显示：{alt}', { alt: element.dataset.readerImageAlt || t('本地图片资源') })
    } else if (kind === 'image-viewer' || kind === 'image-zoom') {
      const alt = element.dataset.readerImageAlt ?? ''
      const label = alt ? t('放大查看图片：{alt}', { alt }) : t('放大查看图片')
      element.setAttribute('aria-label', label)
      element.setAttribute('title', t('放大查看图片'))
      if (kind === 'image-zoom') element.textContent = t('放大查看')
    } else if (kind === 'image-retry') {
      element.textContent = t('重试')
    }
  }
}

function showReaderImageFailure(image: HTMLImageElement, reason: string, locale: AppLocale) {
  const frame = image.closest('.reader-image-frame')
  const placeholder = frame?.querySelector<HTMLElement>('.reader-image-pending')
  if (!frame || !placeholder) return
  image.hidden = true
  image.dataset.readerImageLoaded = 'false'
  image.removeAttribute('src')
  placeholder.hidden = false
  placeholder.classList.add('is-error')
  placeholder.dataset.readerI18n = 'image-loading'
  placeholder.dataset.readerErrorReason = reason
  placeholder.textContent = translate(locale, '图片加载失败：{reason}', { reason })
  if (!frame.querySelector('[data-reader-image-retry]')) {
    const retry = image.ownerDocument.createElement('button')
    retry.type = 'button'
    retry.className = 'reader-image-retry'
    retry.dataset.readerImageRetry = 'true'
    retry.dataset.readerI18n = 'image-retry'
    retry.textContent = translate(locale, '重试')
    frame.append(retry)
  }
}

function resetReaderImagePlaceholder(image: HTMLImageElement, locale: AppLocale) {
  const frame = image.closest('.reader-image-frame')
  const placeholder = frame?.querySelector<HTMLElement>('.reader-image-pending')
  if (!frame || !placeholder) return
  image.removeAttribute('src')
  image.dataset.readerImageLoaded = 'false'
  image.hidden = true
  placeholder.hidden = false
  placeholder.classList.remove('is-error')
  placeholder.dataset.readerI18n = 'image-lazy'
  placeholder.textContent = translate(locale, '图片位于视口附近时加载')
  frame.querySelector('[data-reader-image-retry]')?.remove()
}

export function App() {
  const isDesktop = useMemo(() => isTauri(), [])
  const [initialPersistence] = useState(loadInitialPersistence)
  const [tabState, setTabState] = useState<ReaderTabsState<ReaderDocument>>(() => emptyReaderTabs<ReaderDocument>())
  const [navigation, setNavigation] = useState<NavigationHistory>(emptyNavigationHistory)
  const [navigationBusy, setNavigationBusy] = useState(false)
  const [mermaidHosts, setMermaidHosts] = useState<Array<{ element: HTMLElement; index: number }>>([])
  const [settings, setSettings] = useState<ReaderSettingsV1>(initialPersistence.settings)
  const [recents, setRecents] = useState<RecentFileV1[]>(initialPersistence.recents)
  const [sessionReady, setSessionReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [settingsSectionRequest, setSettingsSectionRequest] = useState(0)
  const [persistenceError, setPersistenceError] = useState(initialPersistence.warnings.join(' '))
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  const [zoom, setZoom] = useState(readZoom)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [mediaContent, setMediaContent] = useState<MediaViewerContent | null>(null)
  const [searchPending, setSearchPending] = useState(false)
  const [fallbackSearch, setFallbackSearch] = useState<{ matches: DocumentSearchMatch[]; index: number } | null>(null)
  const [contentMountedFor, setContentMountedFor] = useState<object | null>(null)
  const [tocWindowStart, setTocWindowStart] = useState(0)
  const tabStateRef = useRef(tabState)
  const navigationRef = useRef(navigation)
  const settingsRef = useRef(settings)
  const recentsRef = useRef(recents)
  const positionsRef = useRef(initialPersistence.positions)
  const storageRef = useRef<StorageLike | null>(getLocalStorage())
  const sessionReadyRef = useRef(false)
  const sessionSuppressedRef = useRef(false)
  const positionWritesSuspendedRef = useRef(false)
  const deferredOpenRef = useRef<DeferredOpen[]>([])
  const positionSaveTimer = useRef<number | undefined>(undefined)
  const sessionSaveTimer = useRef<number | undefined>(undefined)
  const imageRequests = useRef(new Map<string, Promise<string>>())
  const performanceDocumentMarks = useRef(new WeakMap<ReaderDocument, { id: number; requestStartedAt: number; ipcCompletedAt: number }>())
  const loadSequence = useRef(new Map<string, number>())
  const inFlightLoads = useRef(new Map<string, Promise<boolean>>())
  const openBatchSequence = useRef(0)
  const watcherQueue = useRef(Promise.resolve())
  const articleRef = useRef<HTMLElement>(null)
  const headingElementsRef = useRef<HeadingElements>(null)
  const tocNavRef = useRef<HTMLElement>(null)
  const scrollPositionTimer = useRef<number | undefined>(undefined)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const mediaTriggerRef = useRef<HTMLElement | null>(null)
  const searchMatchesRef = useRef<DocumentSearchMatch[]>([])
  const searchRequestSequence = useRef(0)
  const searchScrollFrame = useRef<number | undefined>(undefined)
  const locale: AppLocale = settings.locale ?? DEFAULT_APP_LOCALE
  const t = (source: string, values?: Record<string, string | number>) => translate(locale, source, values)
  const actualTheme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme
  const tabs = tabState.tabs
  const activeTab = tabs.find(tab => tab.id === tabState.activeTabId) ?? null
  const activeTabId = activeTab?.id ?? null
  const readerDocument = activeTab?.document ?? null
  const contentMountKey = useMemo(() => ({}), [activeTabId, readerDocument])
  const contentReady = Boolean(readerDocument && contentMountedFor === contentMountKey)
  const tocHeadingIndexes = useMemo(() => readerDocument && readerDocument.headings.length > TOC_VIRTUAL_THRESHOLD
    ? new Map(readerDocument.headings.map((heading, index) => [heading.id, index]))
    : null, [readerDocument])
  const searchCount = activeTab?.reading.searchMatchCount ?? 0
  const searchOpen = activeTab?.reading.searchOpen ?? false
  const searchQuery = activeTab?.reading.searchQuery ?? ''
  const searchIndex = activeTab?.reading.searchMatchIndex ?? 0
  const tocOpen = activeTab?.reading.tocOpen ?? false
  const loading = activeTab?.status === 'loading'
  const missingOnDisk = activeTab?.status === 'missing'
  const activeError = activeTab?.error || error

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    if (!isDesktop) return
    void invoke('set_application_locale', { locale }).catch(() => undefined)
  }, [isDesktop, locale])

  useEffect(() => {
    if (!performanceEnabled) return
    recordPerformance('reader-mounted', { fromPageStartMs: performance.now() - performancePageStart })
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        recordPerformance('reader-first-frame', { fromPageStartMs: performance.now() - performancePageStart })
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame) cancelAnimationFrame(secondFrame)
    }
  }, [])

  const isActiveImageToken = (token: string) => {
    const state = tabStateRef.current
    const tab = state.tabs.find(item => item.id === state.activeTabId)
    return tab?.document?.imageToken === token
  }

  const commitTabState = useCallback((next: ReaderTabsState<ReaderDocument>) => {
    tabStateRef.current = next
    setTabState(next)
  }, [])

  const commitNavigation = useCallback((next: NavigationHistory) => {
    navigationRef.current = next
    setNavigation(next)
  }, [])

  const captureNavigationLocation = useCallback((): ReadingLocation | null => {
    const active = tabStateRef.current.tabs.find(tab => tab.id === tabStateRef.current.activeTabId)
    if (!active?.document) return null
    const scrollTop = Math.max(0, window.scrollY)
    const currentHeading = findHeadingAtPosition(headingElementsRef.current, articleRef.current, scrollTop + 120)
    const headingId = currentHeading?.id
    const headingOffset = currentHeading?.getBoundingClientRect().top
    const maximum = maxScrollTop()
    return {
      filePath: active.canonicalPath,
      ...(headingId ? { headingId } : {}),
      scrollTop,
      scrollRatio: maximum > 0 ? Math.min(1, scrollTop / maximum) : 0,
      ...(typeof headingOffset === 'number' ? { headingOffset } : {}),
      restoreMode: 'position',
    }
  }, [])

  const patchTab = useCallback((id: string, update: (tab: ReaderTabState) => ReaderTabState) => {
    commitTabState(updateReaderTab(tabStateRef.current, id, update))
  }, [commitTabState])

  const patchActiveReading = useCallback((patch: Partial<ReaderReadingState>) => {
    const id = tabStateRef.current.activeTabId
    if (!id) return
    patchTab(id, tab => ({ ...tab, reading: { ...tab.reading, ...patch } }))
  }, [patchTab])

  const persistPositions = useCallback((next: ReadingPositionsV1, delayMs = 450) => {
    positionsRef.current = next
    if (positionSaveTimer.current !== undefined) window.clearTimeout(positionSaveTimer.current)
    positionSaveTimer.current = window.setTimeout(() => {
      positionSaveTimer.current = undefined
      const storage = storageRef.current
      if (!storage || !saveReadingPositions(storage, positionsRef.current)) {
        setPersistenceError('阅读位置无法保存到本机，请检查浏览器存储空间。')
      }
    }, delayMs)
  }, [])

  const storePosition = useCallback((path: string, position: ReadingPositionV1, delayMs = 450) => {
    if (!settingsRef.current.rememberPosition || positionWritesSuspendedRef.current) return
    persistPositions(mergePosition(positionsRef.current, { ...position, path }), delayMs)
  }, [persistPositions])

  const saveActivePosition = useCallback(() => {
    const state = tabStateRef.current
    const id = state.activeTabId
    const active = state.tabs.find(tab => tab.id === id)
    if (!id || !active) return
    const headingId = findHeadingAtPosition(headingElementsRef.current, articleRef.current, window.scrollY + 120)?.id
    const position = captureReadingPosition(active.canonicalPath, headingId)
    patchTab(id, tab => ({
      ...tab,
      reading: {
        ...tab.reading,
        scrollTop: position.scrollTop,
        scrollRatio: position.scrollRatio,
        headingId: position.headingId,
      },
    }))
    storePosition(active.canonicalPath, position)
  }, [patchTab, storePosition])

  const updateSettings = useCallback((patch: Partial<ReaderSettingsV1>) => {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    const storage = storageRef.current
    if (!storage || !saveReaderSettings(storage, next)) {
      setPersistenceError('设置无法保存到本机，请检查浏览器存储空间。')
      setNotice('设置未能保存到本机，当前更改仅在本次运行中生效。')
    } else {
      setPersistenceError('')
    }
    if (patch.restoreTabs === false) {
      sessionSuppressedRef.current = true
      if (!storage || !clearSessionState(storage)) {
        setPersistenceError('恢复会话无法清除。')
      }
    }
    if (patch.restoreTabs === true) sessionSuppressedRef.current = false
    if (patch.rememberPosition === false) {
      if (positionSaveTimer.current !== undefined) window.clearTimeout(positionSaveTimer.current)
      positionSaveTimer.current = undefined
    }
    if (patch.rememberPosition === true) positionWritesSuspendedRef.current = false
  }, [])

  const updateRecentFiles = useCallback((paths: string[]) => {
    let next = recentsRef.current
    for (const path of paths) next = recordRecentFile(next, path)
    recentsRef.current = next
    setRecents(next)
    const storage = storageRef.current
    if (!storage || !saveRecentFiles(storage, next)) {
      setPersistenceError('最近文件列表无法保存到本机，请检查浏览器存储空间。')
    }
  }, [])
  const loadReaderImage = useCallback(async (image: HTMLImageElement): Promise<string | null> => {
    const token = image.dataset.readerImageToken
    const index = Number(image.dataset.readerImageIndex)
    if (!token || !Number.isInteger(index) || index < 0 || !isDesktop) return null
    if (image.dataset.readerImageLoaded === 'true' && image.src.startsWith('data:image/')) return image.src

    const key = `${token}:${index}`
    let request = imageRequests.current.get(key)
    if (!request) {
      request = invoke<string>('load_reader_image', { imageToken: token, index })
      imageRequests.current.set(key, request)
      void request.then(
        () => { if (imageRequests.current.get(key) === request) imageRequests.current.delete(key) },
        () => { if (imageRequests.current.get(key) === request) imageRequests.current.delete(key) },
      )
    }

    const imageStartedAt = performance.now()
    try {
      const source = await request
      if (!isActiveImageToken(token) || !image.isConnected) return null

      // 正文图片此时仍处于 hidden + loading=lazy 状态；在这个元素上调用
      // decode() 会让 WebKit 等待图片变为可见，形成“等解码才显示、等显示才解码”的死锁。
      // 先用脱离 DOM 的 eager Image 完成解码，再把已解码资源交给正文元素显示。
      const decoder = new Image()
      decoder.decoding = 'async'
      decoder.loading = 'eager'
      decoder.src = source
      await decoder.decode()
      if (!isActiveImageToken(token) || !image.isConnected) return null

      image.loading = 'eager'
      image.src = source
      image.dataset.readerImageLoaded = 'true'
      image.hidden = false
      const frame = image.closest('.reader-image-frame')
      const placeholder = frame?.querySelector<HTMLElement>('.reader-image-pending')
      if (placeholder) {
        placeholder.hidden = true
        placeholder.classList.remove('is-error')
      }
      frame?.querySelector('[data-reader-image-retry]')?.remove()
      const active = tabStateRef.current.tabs.find(tab => tab.id === tabStateRef.current.activeTabId)
      const imageSize = active?.document?.imageAssets.find(asset => asset.index === index)?.size
      recordPerformance('reader-image-ready', {
        documentId: active?.document ? performanceDocumentMarks.current.get(active.document)?.id : undefined,
        durationMs: Number((performance.now() - imageStartedAt).toFixed(3)),
        byteSize: imageSize,
      })
      return source
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      if (isActiveImageToken(token) && image.isConnected) {
        showReaderImageFailure(image, message || '请检查文件是否存在且格式受支持。', locale)
      }
      return null
    }
  }, [isDesktop, locale])
  const html = useMemo(() => {
    if (!readerDocument) return ''
    const startedAt = performance.now()
    const result = displayHtml(
      readerDocument.html,
      readerDocument.mermaidDiagrams.length,
      readerDocument.imageAssets ?? [],
      readerDocument.imageToken ?? '',
    )
    recordPerformance('display-html-prepared', {
      documentId: performanceDocumentMarks.current.get(readerDocument)?.id,
      byteSize: readerDocument.byteSize,
      imageCount: readerDocument.imageAssets?.length ?? 0,
      mermaidCount: readerDocument.mermaidDiagrams?.length ?? 0,
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
    })
    return result
  }, [readerDocument?.html, readerDocument?.imageAssets, readerDocument?.imageToken, readerDocument?.mermaidDiagrams])

  useEffect(() => {
    if (contentReady && articleRef.current) localizeReaderArticle(articleRef.current, locale)
  }, [contentReady, html, locale])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    window.document.documentElement.dataset.theme = actualTheme
    window.document.documentElement.style.setProperty('--reader-font-size', `${settings.fontSizePx}px`)
    const readerWidth = settings.readingWidth === 'fit' ? '100%' : `${READING_WIDTH_PX[settings.readingWidth]}px`
    window.document.documentElement.style.setProperty('--reader-width', readerWidth)
  }, [actualTheme, settings.fontSizePx, settings.readingWidth])

  useEffect(() => {
    window.document.documentElement.style.setProperty('--reader-zoom', String(zoom / 100))
    try { localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom)) } catch { /* 缩放仍可在当前运行中使用。 */ }
  }, [zoom])

  useEffect(() => {
    if (!initialPersistence.migratedSettings) return
    const storage = storageRef.current
    if (!storage) return
    if (saveReaderSettings(storage, settingsRef.current)) {
      try { storage.removeItem(READER_STORAGE_KEYS.legacyTheme) } catch { /* 新版偏好已保存，遗留键清理失败不影响使用。 */ }
    }
  }, [initialPersistence.migratedSettings])

  const persistedTabPaths = tabs.map(tab => tab.canonicalPath).join('\u0000')
  const persistedActivePath = activeTab?.canonicalPath ?? ''
  useEffect(() => {
    if (!sessionReady || !settings.restoreTabs || sessionSuppressedRef.current) return
    if (sessionSaveTimer.current !== undefined) window.clearTimeout(sessionSaveTimer.current)
    sessionSaveTimer.current = window.setTimeout(() => {
      sessionSaveTimer.current = undefined
      const storage = storageRef.current
      if (!storage) {
        setPersistenceError('恢复会话无法保存到本机，请检查浏览器存储空间。')
        return
      }
      const ok = saveSessionState(storage, {
        schemaVersion: 1,
        tabPaths: tabStateRef.current.tabs.map(tab => tab.canonicalPath),
        activePath: tabStateRef.current.tabs.find(tab => tab.id === tabStateRef.current.activeTabId)?.canonicalPath ?? null,
        updatedAt: Date.now(),
      })
      if (!ok) setPersistenceError('恢复会话无法保存到本机，请检查浏览器存储空间。')
    }, 280)
    return () => {
      if (sessionSaveTimer.current !== undefined) window.clearTimeout(sessionSaveTimer.current)
      sessionSaveTimer.current = undefined
    }
  }, [persistedActivePath, persistedTabPaths, sessionReady, settings.restoreTabs])

  useEffect(() => {
    if (!sessionReady) return
    const beforeUnload = () => {
      const storage = storageRef.current
      if (!storage) return
      const active = tabStateRef.current.tabs.find(tab => tab.id === tabStateRef.current.activeTabId)
      if (active && settingsRef.current.rememberPosition && !positionWritesSuspendedRef.current) {
        positionsRef.current = mergePosition(
          positionsRef.current,
          captureReadingPosition(
            active.canonicalPath,
            findHeadingAtPosition(headingElementsRef.current, articleRef.current, window.scrollY + 120)?.id,
          ),
        )
        saveReadingPositions(storage, positionsRef.current)
      }
      if (settingsRef.current.restoreTabs && !sessionSuppressedRef.current) {
        saveSessionState(storage, {
          schemaVersion: 1,
          tabPaths: tabStateRef.current.tabs.map(tab => tab.canonicalPath),
          activePath: active?.canonicalPath ?? null,
          updatedAt: Date.now(),
        })
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [sessionReady])

  const releaseImageToken = useCallback((token?: string) => {
    if (token && isDesktop) void invoke('release_reader_image_document', { imageToken: token }).catch(() => undefined)
  }, [isDesktop])

  const loadReaderTab = useCallback((id: string, filePath: string): Promise<boolean> => {
    if (!tabStateRef.current.tabs.some(tab => tab.id === id)) return Promise.resolve(false)
    const existingRequest = inFlightLoads.current.get(id)
    if (existingRequest) return existingRequest
    const sequence = (loadSequence.current.get(id) ?? 0) + 1
    loadSequence.current.set(id, sequence)
    patchTab(id, tab => ({ ...tab, status: 'loading', stale: false, error: undefined }))

    const request = (async () => {
      try {
        if (!isDesktop) throw new Error('文件只能在 MdStudio 桌面应用中读取。')
        const requestStartedAt = performance.now()
        const loaded = await invoke<ReaderDocument>('load_reader_document', { filePath })
        const ipcCompletedAt = performance.now()
        const documentId = ++nextPerformanceDocumentId
        performanceDocumentMarks.current.set(loaded, { id: documentId, requestStartedAt, ipcCompletedAt })
        recordPerformance('document-ipc-complete', {
          documentId,
          ipcRoundTripMs: Number((ipcCompletedAt - requestStartedAt).toFixed(3)),
          byteSize: loaded.byteSize,
          headingCount: loaded.headings?.length ?? 0,
          mermaidCount: loaded.mermaidDiagrams?.length ?? 0,
          imageCount: loaded.imageAssets?.length ?? 0,
          ...(loaded.performance ?? {}),
        })
        const current = tabStateRef.current.tabs.find(tab => tab.id === id)
        if (!current || loadSequence.current.get(id) !== sequence) {
          releaseImageToken(loaded.imageToken)
          return false
        }
        const previousToken = current.document?.imageToken
        patchTab(id, tab => ({
          ...tab,
          displayName: loaded.fileName,
          status: 'ready',
          stale: false,
          error: undefined,
          document: loaded,
          reading: (() => {
            const saved = settingsRef.current.rememberPosition && !tab.reading.headingId
              ? positionsRef.current.items[tab.canonicalPath]
              : undefined
            return saved ? {
              ...tab.reading,
              headingId: saved.headingId,
              scrollTop: saved.scrollTop,
              scrollRatio: saved.scrollRatio,
            } : tab.reading
          })(),
        }))
        if (previousToken && previousToken !== loaded.imageToken) releaseImageToken(previousToken)
        return true
      } catch (reason) {
        if (loadSequence.current.get(id) !== sequence) return false
        const message = reason instanceof Error ? reason.message : String(reason)
        const current = tabStateRef.current.tabs.find(tab => tab.id === id)
        if (!current) return false
        const missing = /不存在|not found|No such file|os error 2/i.test(message)
        patchTab(id, tab => ({
          ...tab,
          status: missing && tab.document ? 'missing' : tab.document ? 'error' : 'error',
          stale: false,
          error: message,
        }))
        return false
      }
    })()
    const tracked = request.finally(() => {
      if (inFlightLoads.current.get(id) === tracked) inFlightLoads.current.delete(id)
    })
    inFlightLoads.current.set(id, tracked)
    return tracked
  }, [isDesktop, patchTab, releaseImageToken])

  const openDocuments = useCallback(async (
    filePaths: string[],
    source: string,
    anchor?: string,
    preferredActivePath?: string,
  ) => {
    if (!sessionReadyRef.current && source !== 'session-restore') {
      deferredOpenRef.current.push({ paths: [...filePaths], source, ...(anchor ? { anchor } : {}) })
      return false
    }
    const accepted = filePaths.filter(path => /\.(md|markdown)$/i.test(path))
    if (!accepted.length) return false
    if (!isDesktop) {
      setError('文件选择仅在 MdStudio 桌面应用中可用。')
      return false
    }
    if (source !== 'session-restore') sessionSuppressedRef.current = false
    const batch = ++openBatchSequence.current
    setError('')
    const normalized = await Promise.all(accepted.map(async filePath => {
      try {
        return { original: filePath, path: await invoke<string>('normalize_reader_path', { filePath }), error: undefined as string | undefined }
      } catch (reason) {
        return { original: filePath, path: filePath, error: reason instanceof Error ? reason.message : String(reason) }
      }
    }))
    const activeBeforeBatch = tabStateRef.current.activeTabId
    const previousActiveId = tabStateRef.current.activeTabId
    saveActivePosition()
    let next = tabStateRef.current
    const orderedIds: string[] = []
    const shouldLoad = new Set<string>()
    let anchorTargetId: string | undefined
    for (const item of normalized) {
      const id = item.path
      const created: ReaderTabState = {
        id,
        canonicalPath: item.path,
        displayName: pathFileName(item.path),
        status: item.error ? 'error' : 'loading',
        stale: false,
        ...(item.error ? { error: item.error } : {}),
        document: null,
        reading: { ...EMPTY_READING_STATE, ...(anchor ? { headingId: anchor } : {}) },
      }
      const result = addOrActivateTab(next, created)
      next = result.state
      let target = result.tab
      if (!result.created && anchor) {
        next = updateReaderTab(next, target.id, tab => ({ ...tab, reading: { ...tab.reading, headingId: anchor } }))
        target = next.tabs.find(tab => tab.id === target.id) ?? target
      }
      if (anchor) anchorTargetId = target.id
      orderedIds.push(target.id)
      if (result.created) {
        if (!item.error) shouldLoad.add(target.id)
      } else if (item.error) {
        next = updateReaderTab(next, target.id, tab => ({ ...tab, status: 'error', error: item.error }))
      } else if (target.status !== 'ready' || target.stale) {
        shouldLoad.add(target.id)
      }
    }
    if (batch !== openBatchSequence.current && activeBeforeBatch && next.tabs.some(tab => tab.id === activeBeforeBatch)) {
      next = activateReaderTab(next, activeBeforeBatch)
    }
    const activeChanged = next.activeTabId !== tabStateRef.current.activeTabId
    if (activeChanged) setMermaidHosts([])
    commitTabState(next)
    if (activeChanged) setMediaContent(null)
    if (anchor && anchorTargetId === next.activeTabId && next.activeTabId === previousActiveId && next.tabs.find(tab => tab.id === next.activeTabId)?.document) {
      requestAnimationFrame(() => {
        const targetId = resolveHeadingId(next.tabs.find(tab => tab.id === anchorTargetId)?.document?.headings ?? [], anchor)
        const target = targetId ? articleRef.current?.querySelector('#' + CSS.escape(targetId)) : null
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }

    const jobById = new Map<string, Promise<boolean>>()
    for (const id of shouldLoad) {
      const tab = tabStateRef.current.tabs.find(item => item.id === id)
      if (tab) jobById.set(id, loadReaderTab(id, tab.canonicalPath))
    }
    const results = await Promise.all(Array.from(jobById, async ([id, job]) => [id, await job] as const))
    if (batch !== openBatchSequence.current) return false
    const successful = new Set(results.filter(([, ok]) => ok).map(([id]) => id))
    let state = tabStateRef.current
    const successfulPaths = orderedIds.flatMap(id => {
      const tab = state.tabs.find(item => item.id === id)
      return tab?.document && (tab.status === 'ready' || successful.has(id)) ? [tab.canonicalPath] : []
    })
    if (source !== 'session-restore' && successfulPaths.length) updateRecentFiles(successfulPaths)
    if (source === 'session-restore') {
      const failedIds = orderedIds.filter(id => {
        const tab = state.tabs.find(item => item.id === id)
        return !tab?.document || (tab.status !== 'ready' && !successful.has(id))
      })
      if (failedIds.length) {
        let recovered = state
        for (const id of failedIds) recovered = closeReaderTab(recovered, id).state
        commitTabState(recovered)
        state = recovered
        setNotice('部分上次打开的文档无法访问，已跳过。')
      }
    }
    const preferredId = preferredActivePath
      ? orderedIds.find(id => state.tabs.find(item => item.id === id)?.canonicalPath === preferredActivePath)
      : undefined
    const finalId = [...orderedIds].reverse().find(id => {
      const tab = state.tabs.find(item => item.id === id)
      return Boolean(tab?.document && (tab.status === 'ready' || successful.has(id)))
    })
    const activeId = preferredId && state.tabs.find(item => item.id === preferredId)?.document ? preferredId : finalId
    if (activeId) {
      commitTabState(activateReaderTab(tabStateRef.current, activeId))
    }
    return Boolean(activeId)
  }, [commitTabState, isDesktop, loadReaderTab, saveActivePosition, updateRecentFiles])

  const activateTab = useCallback((id: string) => {
    const current = tabStateRef.current.tabs.find(tab => tab.id === tabStateRef.current.activeTabId)
    const target = tabStateRef.current.tabs.find(tab => tab.id === id)
    if (!target) return
    const activationStartedAt = performance.now()
    openBatchSequence.current += 1
    if (current?.id !== id) saveActivePosition()
    const next = activateReaderTab(tabStateRef.current, id)
    if (next.activeTabId !== tabStateRef.current.activeTabId) setMermaidHosts([])
    commitTabState(next)
    if (current?.id !== id) {
      const documentId = target.document ? performanceDocumentMarks.current.get(target.document)?.id : undefined
      requestAnimationFrame(() => requestAnimationFrame(() => recordPerformance('tab-visible', {
        documentId,
        durationMs: Number((performance.now() - activationStartedAt).toFixed(3)),
        tabCount: tabStateRef.current.tabs.length,
      })))
    }
    setError('')
    setMediaContent(null)
    if (target.stale || target.status === 'missing' || target.status === 'error') {
      void loadReaderTab(id, target.canonicalPath)
    }
  }, [commitTabState, loadReaderTab, saveActivePosition])

  const restoreNavigationLocation = useCallback(async (
    location: ReadingLocation,
    behavior: ScrollBehavior = 'instant' as ScrollBehavior,
  ): Promise<boolean> => {
    let target = tabStateRef.current.tabs.find(tab => tab.canonicalPath === location.filePath)
    if (!target || target.status !== 'ready' || target.stale) {
      const opened = await openDocuments([location.filePath], 'navigation-history', location.headingId, location.filePath)
      if (!opened) return false
      target = tabStateRef.current.tabs.find(tab => tab.canonicalPath === location.filePath)
    } else {
      patchTab(target.id, tab => ({
        ...tab,
        reading: {
          ...tab.reading,
          headingId: location.headingId,
          headingOffset: location.headingOffset,
          scrollTop: location.scrollTop,
          scrollRatio: location.scrollRatio,
        },
      }))
      activateTab(target.id)
    }
    if (!target?.document && !tabStateRef.current.tabs.find(tab => tab.canonicalPath === location.filePath)?.document) return false

    const refreshed = tabStateRef.current.tabs.find(tab => tab.canonicalPath === location.filePath)
    if (!refreshed) return false
    patchTab(refreshed.id, tab => ({
      ...tab,
      reading: {
        ...tab.reading,
        headingId: location.headingId,
        headingOffset: location.headingOffset,
        scrollTop: location.scrollTop,
        scrollRatio: location.scrollRatio,
      },
    }))

    await new Promise<void>(resolve => {
      let frame = 0
      let attempts = 0
      let timeout = 0
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        if (frame) cancelAnimationFrame(frame)
        if (timeout) window.clearTimeout(timeout)
        resolve()
      }
      const apply = () => {
        if (settled) return
        attempts += 1
        const state = tabStateRef.current
        const active = state.tabs.find(tab => tab.id === state.activeTabId)
        const article = articleRef.current
        if (active?.canonicalPath === location.filePath && active.document && article) {
          const heading = location.headingId
            ? article.querySelector<HTMLElement>('#' + CSS.escape(location.headingId))
              || article.querySelector<HTMLElement>('#' + CSS.escape('mdstudio-' + location.headingId))
            : null
          if (heading && location.restoreMode === 'heading') {
            heading.scrollIntoView({ behavior, block: 'start' })
            finish()
            return
          }
          if (heading && typeof location.headingOffset === 'number') {
            const top = Math.max(0, window.scrollY + heading.getBoundingClientRect().top - location.headingOffset)
            window.scrollTo({ top, behavior })
            finish()
            return
          }
          if (!location.headingId || attempts >= 8) {
            const top = location.scrollRatio > 0
              ? location.scrollRatio * maxScrollTop()
              : location.scrollTop
            window.scrollTo({ top: Math.max(0, top), behavior })
            finish()
            return
          }
        }
        if (attempts >= 12) {
          finish()
          return
        }
        frame = requestAnimationFrame(apply)
      }
      frame = requestAnimationFrame(apply)
      timeout = window.setTimeout(finish, 240)
    })
    return true
  }, [activateTab, openDocuments, patchTab])

  const navigateToHeading = useCallback(async (headingId: string, closeToc = false) => {
    const departure = captureNavigationLocation()
    const active = tabStateRef.current.tabs.find(tab => tab.id === tabStateRef.current.activeTabId)
    if (!departure || !active?.document) return
    const targetHeadingId = resolveHeadingId(active.document.headings, headingId) ?? headingId
    const target: ReadingLocation = {
      filePath: active.canonicalPath,
      headingId: targetHeadingId,
      scrollTop: 0,
      scrollRatio: 0,
      headingOffset: 76,
      restoreMode: 'heading',
    }
    commitNavigation(recordNavigation(navigationRef.current, departure, target))
    patchActiveReading({ headingId: targetHeadingId, headingOffset: target.headingOffset, ...(closeToc ? { tocOpen: false } : {}) })
    const heading = articleRef.current?.querySelector<HTMLElement>('#' + CSS.escape(targetHeadingId))
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [captureNavigationLocation, commitNavigation, patchActiveReading])

  const navigateToDocument = useCallback(async (filePath: string, anchor?: string) => {
    const departure = captureNavigationLocation()
    const opened = await openDocuments([filePath], 'link', anchor)
    if (!opened || !departure) return
    const active = tabStateRef.current.tabs.find(tab => tab.id === tabStateRef.current.activeTabId)
    if (!active?.document) return
    const headingId = anchor ? resolveHeadingId(active.document.headings, anchor) ?? anchor : undefined
    const target: ReadingLocation = {
      filePath: active.canonicalPath,
      ...(headingId ? { headingId, headingOffset: 76 } : {}),
      scrollTop: 0,
      scrollRatio: 0,
      restoreMode: headingId ? 'heading' : 'position',
    }
    commitNavigation(recordNavigation(navigationRef.current, departure, target))
    await restoreNavigationLocation(target, 'smooth')
  }, [captureNavigationLocation, commitNavigation, openDocuments, restoreNavigationLocation])

  const stepNavigation = useCallback(async (direction: -1 | 1) => {
    if (navigationBusy) return
    const departure = captureNavigationLocation() ?? undefined
    const result = moveNavigation(navigationRef.current, direction, departure)
    if (!result.target) return
    setNavigationBusy(true)
    try {
      const restored = await restoreNavigationLocation(result.target)
      if (restored) commitNavigation(result.history)
      else commitNavigation({ ...result.history, currentIndex: navigationRef.current.currentIndex })
    } finally {
      setNavigationBusy(false)
    }
  }, [captureNavigationLocation, commitNavigation, navigationBusy, restoreNavigationLocation])

  const closeTab = useCallback((id: string) => {
    const before = tabStateRef.current
    const closing = before.tabs.find(tab => tab.id === id)
    if (!closing) return
    openBatchSequence.current += 1
    if (before.activeTabId === id) saveActivePosition()
    loadSequence.current.set(id, (loadSequence.current.get(id) ?? 0) + 1)
    inFlightLoads.current.delete(id)
    const result = closeReaderTab(tabStateRef.current, id)
    if (before.activeTabId === id) setMermaidHosts([])
    commitTabState(result.state)
    releaseImageToken(closing.document?.imageToken)
    if (before.activeTabId === id) setMediaContent(null)
    if (tabStateRef.current.tabs.length === 0) {
      setError('')
      setMermaidHosts([])
    }
  }, [commitTabState, releaseImageToken, saveActivePosition])

  const chooseFile = useCallback(async () => {
    if (!isDesktop) {
      setError('文件选择仅在 MdStudio 桌面应用中可用。')
      return
    }
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        filters: [{ name: 'Markdown 文档', extensions: ['md', 'markdown'] }],
      })
      if (Array.isArray(selected)) await openDocuments(selected, 'picker')
      else if (typeof selected === 'string') await openDocuments([selected], 'picker')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [isDesktop, openDocuments])

  useEffect(() => {
    if (!isDesktop) {
      sessionReadyRef.current = true
      setSessionReady(true)
      return
    }
    let disposed = false
    let stopOpen: (() => void) | undefined
    let stopDrop: (() => void) | undefined
    let stopChanges: (() => void) | undefined
    let stopAbout: (() => void) | undefined
    void (async () => {
      let pending: string[] = []
      try {
        stopOpen = await listen<string>('mdstudio:open-file', event => { void openDocuments([event.payload], 'system') })
        if (disposed) { stopOpen(); return }
        stopAbout = await listen('mdstudio:show-settings-about', () => {
          setSettingsSection('about')
          setSettingsSectionRequest(request => request + 1)
          setSettingsOpen(true)
        })
        if (disposed) { stopAbout(); return }
        stopChanges = await listen<FileChangeEvent>('mdstudio:file-change', event => {
          const paths = new Set(event.payload.paths)
          const changed = tabStateRef.current.tabs.filter(tab => paths.has(tab.canonicalPath))
          for (const tab of changed) {
            if (event.payload.operation === 'removed' || event.payload.operation === 'renamed') {
              patchTab(tab.id, current => ({
                ...current,
                status: 'missing',
                stale: true,
                error: '源文件已删除、移动或重命名；当前保留最后一次成功读取的内容。',
              }))
            } else if (tab.id === tabStateRef.current.activeTabId) {
              const activeLoad = inFlightLoads.current.get(tab.id)
              if (activeLoad) void activeLoad.then(() => loadReaderTab(tab.id, tab.canonicalPath))
              else void loadReaderTab(tab.id, tab.canonicalPath)
            } else {
              patchTab(tab.id, current => ({ ...current, stale: true }))
            }
          }
        })
        if (disposed) { stopChanges(); return }
        stopDrop = await getCurrentWebview().onDragDropEvent(event => {
          if (event.payload.type === 'enter' || event.payload.type === 'over') setDragging(true)
          if (event.payload.type === 'leave') setDragging(false)
          if (event.payload.type === 'drop') {
            setDragging(false)
            const paths = event.payload.paths.filter(value => /\.(md|markdown)$/i.test(value))
            if (paths.length) void openDocuments(paths, 'drop')
          }
        })
        if (disposed) { stopDrop(); return }
        pending = await invoke<string[]>('take_pending_open_files')
        if (disposed) return

        const session = initialPersistence.session
        if (settingsRef.current.restoreTabs && session?.tabPaths.length) {
          await openDocuments(session.tabPaths, 'session-restore', undefined, session.activePath ?? undefined)
        } else if (!settingsRef.current.restoreTabs) {
          const storage = storageRef.current
          if (storage) clearSessionState(storage)
        }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (!disposed) {
          sessionReadyRef.current = true
          setSessionReady(true)
          const deferred = deferredOpenRef.current.splice(0)
          const requests: DeferredOpen[] = [
            ...(pending.length ? [{ paths: pending, source: 'system' }] : []),
            ...deferred,
          ]
          for (const request of requests) {
            if (disposed) break
            await openDocuments(request.paths, request.source, request.anchor)
          }
        }
      }
    })()
    return () => {
      disposed = true
      stopOpen?.()
      stopAbout?.()
      stopDrop?.()
      stopChanges?.()
    }
  }, [initialPersistence.session, isDesktop, loadReaderTab, openDocuments, patchTab])

  const watchedPaths = tabs.map(tab => tab.canonicalPath).join('\u0000')
  useEffect(() => {
    if (!isDesktop) return
    const filePaths = watchedPaths ? watchedPaths.split('\u0000') : []
    watcherQueue.current = watcherQueue.current
      .then(() => invoke('set_reader_watch', { filePaths }))
      .then(() => undefined)
      .catch(() => undefined)
  }, [isDesktop, watchedPaths])

  useLayoutEffect(() => {
    const article = articleRef.current
    if (!article || !readerDocument) {
      headingElementsRef.current = null
      return
    }

    const documentToMount = readerDocument
    const startedAt = performance.now()
    const headingsQuery = 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'
    let cancelled = false
    let frame = 0
    let readableFrame = 0
    let secondReadableFrame = 0
    let cursor = 0
    let blockCount = 0
    let headingIndexMs = 0
    const deferredContent = article.ownerDocument.createDocumentFragment()
    article.replaceChildren()
    headingElementsRef.current = []

    const indexHeadings = (root: ParentNode) => {
      const indexStartedAt = performance.now()
      const indexed = Array.from(root.querySelectorAll<HTMLElement>(headingsQuery))
      headingElementsRef.current?.push(...indexed)
      headingIndexMs += performance.now() - indexStartedAt
    }

    const recordFirstReadable = () => {
      if (!performanceEnabled) return
      readableFrame = requestAnimationFrame(() => {
        secondReadableFrame = requestAnimationFrame(() => {
          const marks = performanceDocumentMarks.current.get(documentToMount)
          if (!marks || cancelled) return
          recordPerformance('document-first-readable', {
            documentId: marks.id,
            byteSize: documentToMount.byteSize,
            elapsedFromRequestMs: Number((performance.now() - marks.requestStartedAt).toFixed(3)),
            elapsedAfterIpcMs: Number((performance.now() - marks.ipcCompletedAt).toFixed(3)),
            headingCount: documentToMount.headings.length,
            mermaidCount: documentToMount.mermaidDiagrams.length,
          })
        })
      })
    }

    const finishMount = () => {
      if (cancelled) return
      recordPerformance('toc-index-built', {
        documentId: performanceDocumentMarks.current.get(documentToMount)?.id,
        headingCount: headingElementsRef.current?.length ?? 0,
        lookupStrategy: 'incremental-dom-heading-binary-search',
        durationMs: Number(headingIndexMs.toFixed(3)),
      })
      recordPerformance('document-content-mounted', {
        documentId: performanceDocumentMarks.current.get(documentToMount)?.id,
        byteSize: documentToMount.byteSize,
        blockCount,
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
      })
      setContentMountedFor(contentMountKey)
    }

    const progressive = html.length > 256 * 1024
      && (documentToMount.imageAssets?.length ?? 0) === 0
      && (documentToMount.mermaidDiagrams?.length ?? 0) === 0
      && !/<img\b/i.test(html)

    if (!progressive) {
      article.innerHTML = html
      indexHeadings(article)
      blockCount = 1
      recordPerformance('document-content-first-batch', {
        documentId: performanceDocumentMarks.current.get(documentToMount)?.id,
        byteSize: documentToMount.byteSize,
        progressive: false,
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
      })
      recordFirstReadable()
      finishMount()
    } else {
      const appendBatch = (isFirstBatch = false) => {
        if (cancelled) return
        const batchStart = cursor
        const batchStartedAt = performance.now()
        const maxBlocks = isFirstBatch ? 64 : 900
        const deadline = batchStartedAt + 8
        let batchBlocks = 0
        while (cursor < html.length && batchBlocks < maxBlocks && (batchBlocks === 0 || performance.now() < deadline)) {
          const end = nextHtmlBlockEnd(html, cursor)
          if (end <= cursor) {
            cursor = html.length
            break
          }
          cursor = end
          batchBlocks += 1
          blockCount += 1
        }

        const template = article.ownerDocument.createElement('template')
        template.innerHTML = html.slice(batchStart, cursor)
        indexHeadings(template.content)
        if (isFirstBatch) article.append(template.content)
        else deferredContent.append(template.content)

        if (isFirstBatch) {
          recordPerformance('document-content-first-batch', {
            documentId: performanceDocumentMarks.current.get(documentToMount)?.id,
            byteSize: documentToMount.byteSize,
            progressive: true,
            blockCount: batchBlocks,
            durationMs: Number((performance.now() - startedAt).toFixed(3)),
          })
          recordFirstReadable()
        }

        if (cursor < html.length) frame = requestAnimationFrame(() => appendBatch())
        else {
          article.append(deferredContent)
          finishMount()
        }
      }
      appendBatch(true)
    }

    return () => {
      cancelled = true
      if (frame) cancelAnimationFrame(frame)
      if (readableFrame) cancelAnimationFrame(readableFrame)
      if (secondReadableFrame) cancelAnimationFrame(secondReadableFrame)
      deferredContent.replaceChildren()
      if (headingElementsRef.current && article === articleRef.current) headingElementsRef.current = null
      article.replaceChildren()
    }
  }, [contentMountKey, html, readerDocument])

  useLayoutEffect(() => {
    if (!readerDocument || !contentReady || !articleRef.current || !activeTab) return
    const article = articleRef.current
    const { headingId, headingOffset, scrollTop, scrollRatio } = activeTab.reading
    const tabId = activeTab.id
    let userMoved = false
    const stopOnIntent = () => { userMoved = true }
    window.addEventListener('wheel', stopOnIntent, { passive: true, once: true })
    window.addEventListener('touchstart', stopOnIntent, { passive: true, once: true })
    window.addEventListener('keydown', stopOnIntent, { once: true })
    const applyPosition = () => {
      if (userMoved || tabStateRef.current.activeTabId !== tabId) return
      const target = headingId
        ? article.querySelector('#' + CSS.escape(headingId))
          || article.querySelector('#' + CSS.escape('mdstudio-' + headingId))
        : null
      if (target && typeof headingOffset === 'number') {
        window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - headingOffset), behavior: 'instant' as ScrollBehavior })
      } else if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior })
      else {
        const top = scrollRatio > 0 ? scrollRatio * maxScrollTop() : scrollTop
        window.scrollTo({ top, behavior: 'instant' as ScrollBehavior })
      }
    }
    const frame = requestAnimationFrame(applyPosition)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(applyPosition) : null
    observer?.observe(article)
    const timer = window.setTimeout(() => observer?.disconnect(), 1400)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.clearTimeout(timer)
      window.removeEventListener('wheel', stopOnIntent)
      window.removeEventListener('touchstart', stopOnIntent)
      window.removeEventListener('keydown', stopOnIntent)
    }
  }, [activeTabId, contentReady, readerDocument?.html])

  useLayoutEffect(() => {
    const article = articleRef.current
    if (!article || !readerDocument || !contentReady) return
    const headings = headingElementsRef.current ?? []
    const active = tabStateRef.current.tabs.find(tab => tab.id === tabStateRef.current.activeTabId)
    const initialHeading = active?.reading.headingId ?? (window.scrollY === 0 ? headings[0]?.id : undefined)
    if (active && active.reading.headingId !== initialHeading) {
      patchTab(active.id, tab => ({ ...tab, reading: { ...tab.reading, headingId: initialHeading } }))
    }
    const timer = window.setTimeout(() => {
      const lookupStartedAt = performance.now()
      const current = findHeadingAtPosition(headings, article, window.scrollY + 120)?.id
      recordPerformance('toc-heading-resolved', {
        documentId: performanceDocumentMarks.current.get(readerDocument)?.id,
        headingCount: headings.length,
        durationMs: Number((performance.now() - lookupStartedAt).toFixed(3)),
      })
      const currentTab = tabStateRef.current.tabs.find(tab => tab.id === tabStateRef.current.activeTabId)
      if (currentTab && currentTab.reading.headingId !== current) {
        patchTab(currentTab.id, tab => ({ ...tab, reading: { ...tab.reading, headingId: current } }))
      }
    }, 80)
    return () => {
      window.clearTimeout(timer)
    }
  }, [activeTabId, contentReady, patchTab, readerDocument?.filePath])

  useEffect(() => {
    if (!readerDocument || !activeTabId) return
    let frame = 0
    const capture = () => {
      const id = tabStateRef.current.activeTabId
      if (!id) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const headingId = findHeadingAtPosition(headingElementsRef.current, articleRef.current, window.scrollY + 120)?.id
        const active = tabStateRef.current.tabs.find(tab => tab.id === id)
        if (!active) return
        if (active.reading.headingId !== headingId) {
          patchTab(id, tab => ({ ...tab, reading: { ...tab.reading, headingId } }))
        }
        if (scrollPositionTimer.current !== undefined) window.clearTimeout(scrollPositionTimer.current)
        scrollPositionTimer.current = window.setTimeout(() => {
          scrollPositionTimer.current = undefined
          const current = tabStateRef.current.tabs.find(tab => tab.id === id)
          if (!current || tabStateRef.current.activeTabId !== id) return
          const latestHeading = findHeadingAtPosition(headingElementsRef.current, articleRef.current, window.scrollY + 120)
          const latestHeadingId = latestHeading?.id
          const position = captureReadingPosition(current.canonicalPath, latestHeadingId)
          positionWritesSuspendedRef.current = false
          patchTab(id, tab => ({
            ...tab,
            reading: {
              ...tab.reading,
              scrollTop: position.scrollTop,
              scrollRatio: position.scrollRatio,
              headingId: latestHeadingId,
              headingOffset: latestHeading?.getBoundingClientRect().top,
            },
          }))
          storePosition(current.canonicalPath, position, 280)
        }, 160)
      })
    }
    window.addEventListener('scroll', capture, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', capture)
      if (scrollPositionTimer.current !== undefined) {
        window.clearTimeout(scrollPositionTimer.current)
        scrollPositionTimer.current = undefined
      }
    }
  }, [activeTabId, readerDocument?.filePath, patchTab, storePosition])

  useEffect(() => {
    const nav = tocNavRef.current
    if (!tocOpen || !nav || !activeTab?.reading.headingId) return
    if (tocHeadingIndexes) {
      const headingIndex = tocHeadingIndexes.get(activeTab.reading.headingId)
      if (headingIndex !== undefined) {
        const viewportHeight = nav.clientHeight || 400
        const maximum = Math.max(0, readerDocument!.headings.length * TOC_ROW_HEIGHT - viewportHeight)
        const targetTop = Math.min(maximum, Math.max(0, headingIndex * TOC_ROW_HEIGHT - viewportHeight / 2))
        nav.scrollTop = targetTop
        setTocWindowStart(current => current === Math.max(0, Math.floor(targetTop / TOC_ROW_HEIGHT) - 3)
          ? current
          : Math.max(0, Math.floor(targetTop / TOC_ROW_HEIGHT) - 3))
        return
      }
    }
    const item = nav.querySelector<HTMLElement>('[aria-current="location"]')
    if (!item) return
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    if (itemTop < nav.scrollTop) nav.scrollTop = itemTop - 7
    else if (itemBottom > nav.scrollTop + nav.clientHeight) nav.scrollTop = itemBottom - nav.clientHeight + 7
  }, [activeTab?.reading.headingId, readerDocument, tocHeadingIndexes, tocOpen])

  useEffect(() => {
    const article = articleRef.current
    if (!article || !readerDocument || !contentReady) return
    const images = Array.from(article.querySelectorAll<HTMLImageElement>('img[data-reader-image="true"]'))
    if (!images.length) return
    const frames = images.map(image => image.closest<HTMLElement>('.reader-image-frame')).filter((frame): frame is HTMLElement => Boolean(frame))

    const onVisibility = (image: HTMLImageElement, visible: boolean) => {
      if (visible) {
        void loadReaderImage(image)
      } else if (image.dataset.readerImageLoaded === 'true') {
        resetReaderImagePlaceholder(image, locale)
      }
    }

    const checkViewport = () => {
      for (const image of images) {
        const bounds = image.closest('.reader-image-frame')?.getBoundingClientRect()
        if (!bounds) continue
        onVisibility(image, bounds.bottom > -480 && bounds.top < window.innerHeight + 480)
      }
    }
    checkViewport()

    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const image = (entry.target as HTMLElement).querySelector<HTMLImageElement>('img[data-reader-image="true"]')
          if (image) onVisibility(image, entry.isIntersecting)
        }
      }, { rootMargin: '480px 0px' })
      frames.forEach(frame => observer.observe(frame))
      return () => observer.disconnect()
    }
    window.addEventListener('scroll', checkViewport, { passive: true })
    window.addEventListener('resize', checkViewport)
    return () => {
      window.removeEventListener('scroll', checkViewport)
      window.removeEventListener('resize', checkViewport)
    }
  }, [contentReady, html, loadReaderImage, locale, readerDocument?.imageToken])

  useLayoutEffect(() => {
    const article = articleRef.current
    if (!readerDocument || !article || !contentReady) return
    const diagrams = readerDocument.mermaidDiagrams
    const hosts = Array.from(article.querySelectorAll<HTMLElement>('[data-mermaid-index]'))
    if (import.meta.env.DEV && hosts.length !== diagrams.length) {
      console.error('[MdStudio Mermaid]', {
        event: 'ast-dom-mapping-error',
        detectedAstBlocks: diagrams.length,
        detectedHtmlBlocks: hosts.length,
      })
    }
    if (import.meta.env.DEV && diagrams.length > 0) {
      console.info('[MdStudio Mermaid]', {
        event: 'comrak-blocks-detected',
        detectedAstBlocks: diagrams.length,
        detectedHtmlBlocks: hosts.length,
        blocks: diagrams.map(({ index, language, source }) => ({ index, language, sourceLength: source.length })),
      })
    }

    setMermaidHosts(hosts.map(host => ({ element: host, index: Number(host.dataset.mermaidIndex) })))
  }, [contentReady, html, readerDocument?.mermaidDiagrams])

  useLayoutEffect(() => {
    const sequence = searchRequestSequence.current + 1
    searchRequestSequence.current = sequence
    clearCssSearchHighlights()
    searchMatchesRef.current = []
    setFallbackSearch(null)

    const article = articleRef.current
    const query = searchQuery.trim()
    const active = activeTabId ? tabStateRef.current.tabs.find(tab => tab.id === activeTabId) : null
    if (readerDocument && !contentReady && searchOpen && query) {
      setSearchPending(true)
      return () => {
        if (searchRequestSequence.current === sequence) searchRequestSequence.current += 1
        clearCssSearchHighlights()
      }
    }

    if (!article || !readerDocument || !searchOpen || !query) {
      setSearchPending(false)
      if (active && active.reading.searchMatchCount !== 0) patchActiveReading({ searchMatchCount: 0 })
      return () => {
        if (searchRequestSequence.current === sequence) searchRequestSequence.current += 1
        clearCssSearchHighlights()
      }
    }

    setSearchPending(true)
    const timer = window.setTimeout(() => {
      if (searchRequestSequence.current !== sequence || tabStateRef.current.activeTabId !== activeTabId) return
      const currentArticle = articleRef.current
      if (!currentArticle) return
      const startedAt = performance.now()
      const matches = findDocumentTextMatches(currentArticle, query)
      const searchElapsedMs = performance.now() - startedAt
      searchMatchesRef.current = matches
      const currentTab = tabStateRef.current.tabs.find(tab => tab.id === activeTabId)
      if (!currentTab || tabStateRef.current.activeTabId !== activeTabId) return
      const index = matches.length ? Math.min(currentTab.reading.searchMatchIndex, matches.length - 1) : 0
      setSearchPending(false)
      patchActiveReading({ searchMatchCount: matches.length, searchMatchIndex: index })
      recordPerformance('search-complete', {
        documentId: readerDocument ? performanceDocumentMarks.current.get(readerDocument)?.id : undefined,
        queryLength: query.length,
        documentTextLength: currentArticle.textContent?.length ?? 0,
        matchCount: matches.length,
        durationMs: Number(searchElapsedMs.toFixed(3)),
      })
      if (import.meta.env.DEV) {
        console.info('[MdStudio Search]', {
          event: 'search-complete',
          tabId: activeTabId,
          queryLength: query.length,
          documentTextLength: currentArticle.textContent?.length ?? 0,
          matchCount: matches.length,
          elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
          customHighlights: supportsCssCustomHighlights(),
        })
      }
    }, 140)

    return () => {
      window.clearTimeout(timer)
      if (searchRequestSequence.current === sequence) searchRequestSequence.current += 1
      clearCssSearchHighlights()
      searchMatchesRef.current = []
    }
  }, [activeTabId, contentReady, readerDocument, patchActiveReading, searchOpen, searchQuery])

  useLayoutEffect(() => {
    const matches = searchMatchesRef.current
    if (!searchOpen || !matches.length) {
      clearCssSearchHighlights()
      setFallbackSearch(null)
      return
    }
    const applied = applyCssSearchHighlights(matches, searchIndex)
    setFallbackSearch(applied ? null : { matches, index: searchIndex })
  }, [activeTabId, searchCount, searchIndex, searchOpen, searchQuery])

  const previousSearch = useRef<{ tabId: string | null; query: string; index: number }>({ tabId: null, query: '', index: 0 })
  useLayoutEffect(() => {
    if (searchScrollFrame.current !== undefined) cancelAnimationFrame(searchScrollFrame.current)
    if (searchPending) return
    const previous = previousSearch.current
    const changedInSameTab = previous.tabId === activeTabId && (previous.index !== searchIndex || previous.query !== searchQuery)
    previousSearch.current = { tabId: activeTabId, query: searchQuery, index: searchIndex }
    const match = searchMatchesRef.current[searchIndex]
    if (!searchOpen || !searchCount || !changedInSameTab || !match) return

    searchScrollFrame.current = requestAnimationFrame(() => {
      searchScrollFrame.current = undefined
      const rect = firstRangeRect(match)
      if (!rect) return
      const topbarBottom = document.querySelector<HTMLElement>('.reader-topbar')?.getBoundingClientRect().bottom ?? 0
      const footerTop = document.querySelector<HTMLElement>('.reader-footer')?.getBoundingClientRect().top ?? window.innerHeight
      const center = (topbarBottom + footerTop) / 2
      const delta = rect.top - center
      if (Math.abs(delta) > 28) window.scrollBy({ top: delta, behavior: 'smooth' })
    })
    return () => {
      if (searchScrollFrame.current !== undefined) cancelAnimationFrame(searchScrollFrame.current)
      searchScrollFrame.current = undefined
    }
  }, [activeTabId, searchCount, searchIndex, searchOpen, searchPending, searchQuery])

  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchOpen])

  const refresh = useCallback(() => {
    const state = tabStateRef.current
    const tab = state.tabs.find(item => item.id === state.activeTabId)
    if (tab) void loadReaderTab(tab.id, tab.canonicalPath)
  }, [loadReaderTab])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || mediaContent || settingsOpen) return
      const target = event.target instanceof HTMLElement ? event.target : null
      const inTextField = target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')
      const command = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      const searchShortcut = command && (key === 'f' || key === 'g')
      if (inTextField && event.key !== 'Escape' && !(event.ctrlKey && event.key === 'Tab') && !searchShortcut) return

      if ((event.metaKey && event.key === '[') || (event.altKey && event.key === 'ArrowLeft')) {
        event.preventDefault()
        void stepNavigation(-1)
        return
      }
      if ((event.metaKey && event.key === ']') || (event.altKey && event.key === 'ArrowRight')) {
        event.preventDefault()
        void stepNavigation(1)
        return
      }

      if (command && key === 'o') {
        event.preventDefault()
        void chooseFile()
      } else if (command && event.key === ',') {
        event.preventDefault()
        setSettingsSection('appearance')
        setSettingsSectionRequest(request => request + 1)
        setSettingsOpen(true)
      } else if (command && key === 'w') {
        event.preventDefault()
        if (tabStateRef.current.activeTabId) closeTab(tabStateRef.current.activeTabId)
      } else if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault()
        const state = tabStateRef.current
        if (state.tabs.length < 2 || !state.activeTabId) return
        const index = state.tabs.findIndex(tab => tab.id === state.activeTabId)
        const next = (index + (event.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length
        activateTab(state.tabs[next].id)
      } else if (command && /^[1-9]$/.test(event.key)) {
        event.preventDefault()
        const state = tabStateRef.current
        const target = event.key === '9' ? state.tabs.at(-1) : state.tabs[Number(event.key) - 1]
        if (target) activateTab(target.id)
      } else if (command && key === 'f') {
        if (!tabStateRef.current.activeTabId) return
        event.preventDefault()
        patchActiveReading({ searchOpen: true, tocOpen: false })
      } else if (command && key === 'g') {
        event.preventDefault()
        const reading = tabStateRef.current.tabs.find(tab => tab.id === tabStateRef.current.activeTabId)?.reading
        if (reading?.searchMatchCount) {
          const direction = event.shiftKey ? -1 : 1
          patchActiveReading({ searchMatchIndex: (reading.searchMatchIndex + direction + reading.searchMatchCount) % reading.searchMatchCount })
        }
      } else if (command && event.key === '0') {
        event.preventDefault()
        setZoom(100)
      } else if (command && key === 'r' && !event.shiftKey) {
        event.preventDefault()
        refresh()
      } else if (event.key === 'Escape') {
        patchActiveReading({ searchOpen: false, tocOpen: false })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activateTab, chooseFile, closeTab, mediaContent, patchActiveReading, refresh, settingsOpen, stepNavigation])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const changeSearch = (delta: number) => {
    if (searchCount) patchActiveReading({ searchMatchIndex: (searchIndex + delta + searchCount) % searchCount })
  }

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (!searchPending) changeSearch(event.shiftKey ? -1 : 1)
  }

  const removeRecent = (path: string) => {
    const next = removeRecentFile(recentsRef.current, path)
    recentsRef.current = next
    setRecents(next)
    const storage = storageRef.current
    if (!storage || !saveRecentFiles(storage, next)) setPersistenceError('最近文件列表无法保存到本机。')
  }

  const clearRecents = () => {
    recentsRef.current = []
    setRecents([])
    const storage = storageRef.current
    if (!storage || !clearRecentFiles(storage)) setPersistenceError('最近文件列表无法清除。')
  }

  const clearPositions = () => {
    if (positionSaveTimer.current !== undefined) window.clearTimeout(positionSaveTimer.current)
    positionSaveTimer.current = undefined
    positionWritesSuspendedRef.current = true
    const empty: ReadingPositionsV1 = { schemaVersion: 1, items: {} }
    positionsRef.current = empty
    const storage = storageRef.current
    if (!storage || !clearReadingPositions(storage)) setPersistenceError('阅读位置记录无法清除。')
  }

  const clearSession = () => {
    sessionSuppressedRef.current = true
    if (sessionSaveTimer.current !== undefined) window.clearTimeout(sessionSaveTimer.current)
    sessionSaveTimer.current = undefined
    const storage = storageRef.current
    if (!storage || !clearSessionState(storage)) setPersistenceError('恢复会话无法清除。')
  }

  const openImageViewer = useCallback(async (image: HTMLImageElement, trigger: HTMLElement) => {
    const source = image.dataset.readerImageLoaded === 'true' ? image.src : await loadReaderImage(image)
    if (!source) return
    mediaTriggerRef.current = trigger
    setMediaContent({ kind: 'image', src: source, alt: image.alt })
  }, [loadReaderImage])

  useEffect(() => {
    const article = articleRef.current
    if (!article || !readerDocument) return
    const onImageTrigger = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const trigger = target.closest<HTMLElement>('button[data-reader-image-viewer]')
      if (!trigger) return
      const image = trigger.closest('.reader-image-frame')?.querySelector<HTMLImageElement>('img[data-reader-image="true"]')
      if (!image) return
      event.preventDefault()
      event.stopPropagation()
      void openImageViewer(image, trigger)
    }
    article.addEventListener('click', onImageTrigger, true)
    return () => article.removeEventListener('click', onImageTrigger, true)
  }, [html, openImageViewer, readerDocument])

  const onArticleClick = async (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    const retryButton = target.closest<HTMLButtonElement>('[data-reader-image-retry]')
    if (retryButton) {
      event.preventDefault()
      const image = retryButton.closest('.reader-image-frame')?.querySelector<HTMLImageElement>('img[data-reader-image="true"]')
      if (image) void loadReaderImage(image)
      return
    }
    const imageButton = target.closest<HTMLButtonElement>('[data-reader-image-viewer]')
    if (imageButton) {
      event.preventDefault()
      event.stopPropagation()
      const image = imageButton.closest('.reader-image-frame')?.querySelector<HTMLImageElement>('img[data-reader-image="true"]')
      if (image) void openImageViewer(image, imageButton)
      return
    }
    const clickedImage = target.closest<HTMLImageElement>('img[data-reader-image="true"]')
    if (clickedImage && !clickedImage.closest('a[href]')) {
      event.preventDefault()
      void openImageViewer(clickedImage, clickedImage)
      return
    }
    const copyButton = target.closest<HTMLButtonElement>('[data-copy-code]')
    if (copyButton) {
      event.preventDefault()
      try {
        await navigator.clipboard.writeText(copyButton.closest('pre')?.querySelector('code')?.textContent ?? '')
        copyButton.textContent = t('已复制')
        setNotice('代码已复制')
        window.setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = t('复制') }, 1400)
      } catch {
        setError('无法访问系统剪贴板，请手动选择代码复制。')
      }
      return
    }
    const link = target.closest<HTMLAnchorElement>('a[href]')
    if (!link) return
    const href = link.getAttribute('href') || ''
    if (href.startsWith('#')) {
      event.preventDefault()
      await navigateToHeading(decodeAnchor(href.slice(1)))
      return
    }
    if (href.startsWith('mdstudio-document:')) {
      event.preventDefault()
      try {
        const url = new URL(href)
        const filePath = url.searchParams.get('path')
        if (!filePath) throw new Error('文档链接无效。')
        await navigateToDocument(filePath, url.hash ? decodeAnchor(url.hash.slice(1)) : undefined)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
      return
    }
    if (href.startsWith('https://')) {
      event.preventDefault()
      try {
        await invoke('open_external_url', { url: href })
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
      return
    }
    event.preventDefault()
  }

  const onArticleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target as HTMLElement
    const image = target.closest<HTMLImageElement>('img[role="button"][data-reader-image="true"]')
    if (!image) return
    event.preventDefault()
    void openImageViewer(image, image)
  }

  const cycleTheme = () => updateSettings({ theme: settings.theme === 'system' ? 'light' : settings.theme === 'light' ? 'dark' : 'system' })
  const exportPdf = async () => {
    if (!isDesktop || !readerDocument || !contentReady || exportingPdf) return
    const documentBaseName = readerDocument.fileName.replace(/\.(?:md|markdown)$/i, '')
    let filePath: string | null
    try {
      filePath = await save({
        title: t('导出 PDF'),
        defaultPath: `${documentBaseName}.pdf`,
        filters: [{ name: t('PDF 文件'), extensions: ['pdf'] }],
      })
    } catch {
      setError('PDF 导出失败，请检查目标位置后重试。')
      return
    }
    if (!filePath) return

    const article = articleRef.current
    if (!article) return
    const previouslyLoaded = new Set(Array.from(article.querySelectorAll<HTMLImageElement>('img[data-reader-image="true"]'))
      .filter(image => image.dataset.readerImageLoaded === 'true'))
    const previousTitle = document.title
    setExportingPdf(true)
    setError('')
    document.title = `${documentBaseName} — MdStudio`
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      await document.fonts?.ready

      const images = Array.from(article.querySelectorAll<HTMLImageElement>('img[data-reader-image="true"]'))
      let imageLoadTimeout: number | undefined
      const imagesReady = await Promise.race([
        Promise.allSettled(images.map(image => loadReaderImage(image))).then(() => true),
        new Promise<boolean>(resolve => {
          imageLoadTimeout = window.setTimeout(() => resolve(false), 30_000)
        }),
      ])
      if (imageLoadTimeout !== undefined) window.clearTimeout(imageLoadTimeout)
      if (!imagesReady) throw new Error('图片加载超过 30 秒，已取消 PDF 导出。')

      const mermaidHosts = Array.from(article.querySelectorAll<HTMLElement>('.reader-mermaid-host'))
      const deadline = Date.now() + 30_000
      const waitingForDiagrams = () => mermaidHosts.some(host => {
        const diagram = host.querySelector('.reader-mermaid')
        if (!diagram) return true
        return Boolean(diagram.querySelector('.reader-mermaid-loading') && !diagram.querySelector('.reader-mermaid-error'))
      })
      while (waitingForDiagrams() && Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 50))
      }
      if (waitingForDiagrams()) throw new Error('Mermaid 图表渲染超过 30 秒，已取消 PDF 导出。')

      await invoke('export_reader_pdf', { filePath })
      const exportedName = filePath.split(/[\\/]/).filter(Boolean).at(-1) || `${documentBaseName}.pdf`
      setNotice(t('PDF 已保存：{name}', { name: exportedName }))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'PDF 导出失败，请检查目标位置后重试。'
      setError(message)
    } finally {
      document.title = previousTitle
      for (const image of article.querySelectorAll<HTMLImageElement>('img[data-reader-image="true"]')) {
        if (previouslyLoaded.has(image) || image.dataset.readerImageLoaded !== 'true') continue
        const bounds = image.closest('.reader-image-frame')?.getBoundingClientRect()
        if (!bounds || bounds.bottom < -480 || bounds.top > window.innerHeight + 480) resetReaderImagePlaceholder(image, locale)
      }
      setExportingPdf(false)
    }
  }
  const logo = <img className="brand-logo" src={actualTheme === 'dark' ? logoDark : logoLight} alt="MdStudio" />
  const headerLogo = <img className="brand-symbol" src={logoSymbol} alt="" aria-hidden="true" />
  const mermaidPortals = mermaidHosts.flatMap(({ element, index }) => {
    const diagram = readerDocument?.mermaidDiagrams[index]
    if (!diagram) return []
    return [createPortal(
      <Suspense fallback={<div className="reader-mermaid-loading" role="status">{t('正在加载 Mermaid 图表…')}</div>}>
        <MermaidDiagram
          source={diagram.source}
          language={diagram.language}
          theme={actualTheme}
          documentId={readerDocument ? performanceDocumentMarks.current.get(readerDocument)?.id : undefined}
          diagramIndex={diagram.index}
        />
      </Suspense>,
      element,
      `${readerDocument.filePath}-${index}`,
    )]
  })
  const tocHeadings = readerDocument?.headings ?? []
  const tocStart = tocHeadingIndexes
    ? Math.min(tocWindowStart, Math.max(0, tocHeadings.length - TOC_VISIBLE_ROWS))
    : 0
  const tocEnd = tocHeadingIndexes ? Math.min(tocHeadings.length, tocStart + TOC_VISIBLE_ROWS) : tocHeadings.length

  return (
    <I18nProvider locale={locale}>
    <div className={'reader-shell' + (dragging ? ' is-dragging' : '')}>
      <AppHeader
        logo={headerLogo}
        tabs={tabs}
        activeTabId={activeTabId}
        loading={loading}
        searchOpen={searchOpen && Boolean(readerDocument)}
        searchQuery={searchQuery}
        searchIndex={searchIndex}
        searchCount={searchCount}
        searchPending={searchPending}
        tocOpen={tocOpen}
        theme={settings.theme}
        doubleClickToClose={settings.doubleClickToClose}
        searchInputRef={searchInputRef}
        canGoBack={navigation.currentIndex > 0}
        canGoForward={navigation.currentIndex >= 0 && navigation.currentIndex < navigation.entries.length - 1}
        navigationBusy={navigationBusy}
        canExportPdf={Boolean(isDesktop && readerDocument && contentReady && !loading)}
        exportingPdf={exportingPdf}
        onGoBack={() => { void stepNavigation(-1) }}
        onGoForward={() => { void stepNavigation(1) }}
        onExportPdf={() => { void exportPdf() }}
        onRefresh={refresh}
        onToggleSearch={() => patchActiveReading({ searchOpen: !searchOpen, tocOpen: false })}
        onToggleToc={() => patchActiveReading({ tocOpen: !tocOpen, searchOpen: false })}
        onCycleTheme={cycleTheme}
        onOpenSettings={() => { setSettingsSection('appearance'); setSettingsSectionRequest(request => request + 1); setSettingsOpen(true) }}
        onOpenFile={() => void chooseFile()}
        onSearchQueryChange={query => {
          setSearchPending(Boolean(query.trim()))
          patchActiveReading({ searchQuery: query, searchMatchIndex: 0, searchMatchCount: 0 })
        }}
        onSearchPrevious={() => changeSearch(-1)}
        onSearchNext={() => changeSearch(1)}
        onSearchClear={() => {
          setSearchPending(false)
          patchActiveReading({ searchQuery: '', searchMatchIndex: 0, searchMatchCount: 0 })
          searchInputRef.current?.focus()
        }}
        onSearchKeyDown={handleSearchKeyDown}
        onCloseSearch={() => {
          setSearchPending(false)
          setFallbackSearch(null)
          patchActiveReading({ searchOpen: false })
        }}
        onActivateTab={activateTab}
        onCloseTab={closeTab}
      />

      {tocOpen && readerDocument && <aside className="toc-popover" aria-label={t('文档目录')}>
        <div className="popover-heading"><strong>{t('目录')}</strong><button className="icon-button compact" onClick={() => patchActiveReading({ tocOpen: false })} aria-label={t('关闭目录')}><X size={15} /></button></div>
        {readerDocument.headings.length ? <nav ref={tocNavRef} onScroll={tocHeadingIndexes ? event => {
          const start = Math.max(0, Math.floor(event.currentTarget.scrollTop / TOC_ROW_HEIGHT) - 3)
          setTocWindowStart(current => Math.abs(current - start) >= 2 ? start : current)
        } : undefined}>
          {tocStart > 0 && <div className="toc-virtual-spacer" aria-hidden="true" style={{ height: tocStart * TOC_ROW_HEIGHT }} />}
          {tocHeadings.slice(tocStart, tocEnd).map((heading, offset) => {
            const index = tocStart + offset
            return <button
            key={heading.id + '-' + index}
            className={'toc-item' + (activeTab?.reading.headingId === heading.id ? ' is-current' : '')}
            aria-current={activeTab?.reading.headingId === heading.id ? 'location' : undefined}
            style={{ '--toc-level': heading.level } as CSSProperties}
            onClick={() => { void navigateToHeading(heading.id, true) }}
            title={heading.text}
          >{heading.text}</button>
          })}
          {tocEnd < tocHeadings.length && <div className="toc-virtual-spacer" aria-hidden="true" style={{ height: (tocHeadings.length - tocEnd) * TOC_ROW_HEIGHT }} />}
        </nav> : <p className="empty-toc">{t('本文没有标题。')}</p>}
      </aside>}

      <main className={'reader-main' + (readerDocument ? ' has-document' : ' is-home')}>
        {activeError && <div className={'reader-alert' + (missingOnDisk ? ' is-warning' : '')} role={missingOnDisk ? 'status' : 'alert'}><span>{t(activeError)}</span>{activeTab && <button onClick={refresh}>{t('重试')}</button>}{!activeTab && <button onClick={() => setError('')} aria-label={t('关闭提示')}><X size={15} /></button>}</div>}
        {readerDocument ? <>
          {readerDocument.missingResources.length > 0 && <div className="resource-notice" role="status">
            <span>{t('部分资源无法显示：{resources}{more}', {
              resources: readerDocument.missingResources.slice(0, 3).join(locale === 'zh-CN' ? '；' : ', '),
              more: readerDocument.missingResources.length > 3 ? t(' 等 {count} 项', { count: readerDocument.missingResources.length - 3 }) : '',
            })}</span>
          </div>}
          <article
            key={activeTabId ?? 'reader'}
            ref={articleRef}
            className="reader-article"
            id="reader-tabpanel"
            role="tabpanel"
            aria-labelledby={`reader-tab-${tabs.findIndex(tab => tab.id === activeTabId)}`}
            onClick={event => { void onArticleClick(event) }}
            onKeyDown={onArticleKeyDown}
            style={{ '--reader-zoom': zoom / 100 } as CSSProperties}
          />
        </> : activeTab ? <section className="reader-tab-load-state" role={activeTab.status === 'error' ? 'alert' : 'status'}>
          {activeTab.status === 'loading' ? <LoaderCircle className="is-spinning" size={22} /> : <FileText size={22} />}
          <strong>{activeTab.displayName}</strong>
          <span>{t(activeTab.error || (activeTab.status === 'loading' ? '正在读取 Markdown 文档…' : '文档尚未读取。'))}</span>
          {activeTab.status !== 'loading' && <button className="open-button" onClick={refresh}><RefreshCw size={15} />{t('重试打开')}</button>}
        </section> : <section className="welcome-panel">
          <div className="welcome-logo">{logo}</div>
          <div className="welcome-copy"><h1>{t('打开即读，简单纯粹。')}</h1><p>{t('选择一份 Markdown 文档，或将文件拖到这里。')}</p></div>
          <button className="open-button primary" onClick={() => void chooseFile()}><FolderOpen size={16} /><span>{t('打开 Markdown 文件')}</span></button>
          <span className="file-types">{t('支持 .md 和 .markdown')}</span>
        </section>}
        {dragging && <div className="drop-overlay"><div><BookOpen size={25} /><strong>{t('松开放入 Markdown 文档')}</strong><span>{t('支持 .md 和 .markdown')}</span></div></div>}
      </main>

      {fallbackSearch && searchOpen && !mediaContent && <SearchHighlightCanvas
        matches={fallbackSearch.matches}
        currentIndex={fallbackSearch.index}
        dark={actualTheme === 'dark'}
        articleRef={articleRef}
      />}

      <footer className="reader-footer">
        <div className="footer-left"><span className="readonly-dot" />{t('只读')}{readerDocument && <><span className="footer-separator">·</span><span className="footer-file-size">{formatByteSize(readerDocument.byteSize)}</span></>}</div>
        {readerDocument && <div className="zoom-controls" aria-label={t('阅读缩放')}>
          <button className="icon-button compact" onClick={() => setZoom(value => Math.max(85, value - 5))} disabled={zoom <= 85} aria-label={t('缩小字号')}><ZoomOut size={15} /></button>
          <button className="zoom-value" onClick={() => setZoom(100)} title={t('恢复默认缩放（⌘0 / Ctrl+0）')}>{zoom}%</button>
          <button className="icon-button compact" onClick={() => setZoom(value => Math.min(140, value + 5))} disabled={zoom >= 140} aria-label={t('放大字号')}><ZoomIn size={15} /></button>
        </div>}
        <div className="footer-right">
          <ReadingWidthPicker value={settings.readingWidth} onChange={readingWidth => updateSettings({ readingWidth })} />
          <span className="footer-product-label">{readerDocument ? t('Markdown 阅读器') : 'MdStudio'}</span>
        </div>
      </footer>
      {notice && <div className={'reader-toast' + (notice.startsWith('设置未能保存') ? ' is-warning' : '')} role={notice.startsWith('设置未能保存') ? 'alert' : 'status'}>
        {notice.startsWith('设置未能保存') ? <AlertCircle size={15} /> : <Check size={15} />}{t(notice)}
      </div>}
      {mermaidPortals}
      {mediaContent && <MediaViewerDialog
        content={mediaContent}
        triggerRef={mediaTriggerRef}
        onClose={() => setMediaContent(null)}
      />}
      <SettingsDialog
        open={settingsOpen}
        initialSection={settingsSection}
        sectionRequestId={settingsSectionRequest}
        settings={settings}
        recents={recents}
        logoSrc={actualTheme === 'dark' ? logoDark : logoLight}
        persistenceError={persistenceError}
        onClose={() => setSettingsOpen(false)}
        onSettingsChange={updateSettings}
        onOpenRecent={path => { setSettingsOpen(false); void openDocuments([path], 'recent') }}
        onRemoveRecent={removeRecent}
        onClearRecents={clearRecents}
        onClearPositions={clearPositions}
        onClearSession={clearSession}
      />
    </div>
    </I18nProvider>
  )
}
