import { OFDViewer } from '@ofdrw/ofdrw-viewer-ui/react'
import type { OFDViewerHandle } from '@ofdrw/ofdrw-viewer-ui/react'
import type { OutlineNode } from '@ofdrw/ofdrw-viewer-ui'
import { invoke } from '@tauri-apps/api/core'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ForwardedRef } from 'react'
import '@ofdrw/ofdrw-viewer-ui/style.css'
import './OfdViewer.css'
import type { AppLocale, OfdFallbackFont, ReadingWidth } from '../../features/reader/preferences'
import { useI18n } from '../../features/i18n'
import type { OfdReaderDocument } from '../../features/documents/ofd/reader'

type OfdViewerProps = {
  tabId: string
  document: OfdReaderDocument
  locale: AppLocale
  dark: boolean
  readingWidth?: ReadingWidth
  systemFontFallback?: boolean
  fallbackFont?: OfdFallbackFont
  initialPage: number
  initialScale: number
  initialRotation: number
  searchOpen: boolean
  searchQuery: string
  onReadingChange: (tabId: string, page: number, scale: number, rotation: number) => void
  onPageCountChange: (tabId: string, pageCount: number) => void
  onOutlineChange: (tabId: string, outline: readonly OutlineNode[]) => void
  onSearchChange: (tabId: string, count: number, index: number) => void
  onSearchPendingChange: (tabId: string, pending: boolean) => void
  onFitHeightReady?: (fitHeight: (() => void) | null) => void
}

function OfdViewerComponent({
  document,
  tabId,
  locale,
  dark,
  readingWidth = 'wide',
  systemFontFallback = false,
  fallbackFont = 'auto',
  initialPage,
  initialScale,
  initialRotation,
  searchOpen,
  searchQuery,
  onReadingChange,
  onPageCountChange,
  onOutlineChange,
  onSearchChange,
  onSearchPendingChange,
  onFitHeightReady,
}: OfdViewerProps, forwardedRef: ForwardedRef<OFDViewerHandle>) {
  const t = useI18n()
  const [viewerReady, setViewerReady] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [currentScale, setCurrentScale] = useState(initialScale)
  const [currentRotation, setCurrentRotation] = useState(initialRotation)
  const previousReadingWidthRef = useRef(readingWidth)
  const pendingWidthFitRef = useRef(false)
  const [fontResolution, setFontResolution] = useState<{
    sessionId: string
    sources: Array<{ index: number; family: string; coveredCharacters: number; requiredCharacters: number }>
    aliases: string[][]
  } | null>(null)
  const [fontsReady, setFontsReady] = useState(!systemFontFallback || document.fontResources.length === 0)
  const viewerHandleRef = useRef<OFDViewerHandle | null>(null)
  const viewerHostRef = useRef<HTMLDivElement | null>(null)
  const pendingScrollRestoreRef = useRef<{ filePath: string; scrollTop: number } | null>(null)
  const fontBytesRef = useRef(new Map<string, Uint8Array[]>())
  const closingFontSessionsRef = useRef(new Set<string>())
  const releaseFontSession = useCallback((sessionId: string) => {
    for (const bytes of fontBytesRef.current.get(sessionId) ?? []) bytes.fill(0)
    fontBytesRef.current.delete(sessionId)
    void invoke('release_ofd_system_fonts', { sessionId }).catch(() => undefined)
  }, [])
  const restoreScrollPosition = useCallback((filePath: string) => {
    const pending = pendingScrollRestoreRef.current
    if (!pending || pending.filePath !== filePath) return
    const main = viewerHostRef.current?.querySelector<HTMLElement>('.ofd-viewer__main')
    if (!main) return
    main.scrollTop = pending.scrollTop
    pendingScrollRestoreRef.current = null
  }, [])
  const fitHeight = useCallback(() => {
    const handle = viewerHandleRef.current
    const state = handle?.getState()
    const main = viewerHostRef.current?.querySelector<HTMLElement>('.ofd-viewer__main')
    if (!handle || !state || !main) return
    const page = main.querySelector<HTMLElement>(`.ofd-page[data-page-number="${state.view.pageNumber}"] .ofd-page__surface`)
    if (!page) return
    const style = window.getComputedStyle(main)
    const verticalPadding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
    const availableHeight = main.clientHeight - verticalPadding - 16
    const renderedHeight = page.getBoundingClientRect().height
    if (availableHeight > 0 && renderedHeight > 0) {
      handle.setScale(state.view.scale * availableHeight / renderedHeight)
    }
  }, [])
  const setViewerHandle = useMemo(() => {
    const sessionId = fontResolution?.sessionId
    return (handle: OFDViewerHandle | null) => {
      if (handle) {
        viewerHandleRef.current = handle
        if (sessionId) fontBytesRef.current.set(sessionId, fontBytesRef.current.get(sessionId) ?? [])
      } else {
        const previous = viewerHandleRef.current
        viewerHandleRef.current = null
        if (previous) {
          const scrollTop = previous.getState()?.view.scrollTop
          if (typeof scrollTop === 'number' && Number.isFinite(scrollTop)) {
            pendingScrollRestoreRef.current = { filePath: document.filePath, scrollTop }
          }
          const closing = previous.close()
          if (sessionId && !closingFontSessionsRef.current.has(sessionId)) {
            closingFontSessionsRef.current.add(sessionId)
            void closing.finally(() => {
              closingFontSessionsRef.current.delete(sessionId)
              releaseFontSession(sessionId)
            }).catch(() => undefined)
          }
        } else if (sessionId && !closingFontSessionsRef.current.has(sessionId)) {
          releaseFontSession(sessionId)
        }
      }
      if (typeof forwardedRef === 'function') forwardedRef(handle)
      else if (forwardedRef) forwardedRef.current = handle
    }
  }, [document.filePath, fontResolution?.sessionId, forwardedRef, releaseFontSession])

  useEffect(() => {
    onFitHeightReady?.(fitHeight)
    return () => onFitHeightReady?.(null)
  }, [fitHeight, onFitHeightReady])

  useEffect(() => {
    setViewerReady(false)
    setError('')
    setCurrentPage(initialPage)
    setCurrentScale(initialScale)
    setCurrentRotation(initialRotation)
    onSearchChange(tabId, 0, 0)
  }, [document.filePath, document.modifiedUnixMicros])

  useEffect(() => {
    if (previousReadingWidthRef.current !== readingWidth) {
      previousReadingWidthRef.current = readingWidth
      pendingWidthFitRef.current = true
    }
    if (!pendingWidthFitRef.current || !viewerReady) return
    const frame = requestAnimationFrame(() => {
      const handle = viewerHandleRef.current
      if (!handle) return
      handle.setZoomMode(readingWidth === 'fit' ? 'page-fit' : 'page-width')
      pendingWidthFitRef.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [readingWidth, viewerReady])

  useEffect(() => {
    let active = true
    if (!systemFontFallback || document.fontResources.length === 0) {
      setFontResolution(null)
      setFontsReady(true)
      return
    }
    setFontResolution(null)
    const sessionId = crypto.randomUUID()
    setFontsReady(false)
    void invoke<{
      sessionId: string
      sources: Array<{ index: number; family: string; coveredCharacters: number; requiredCharacters: number }>
      aliases: string[][]
    }>('resolve_ofd_system_fonts', {
      sessionId,
      requests: document.fontResources,
      fallbackPreference: fallbackFont,
    }).then(result => {
      if (!active) {
        void invoke('release_ofd_system_fonts', { sessionId }).catch(() => undefined)
        return
      }
      setFontResolution(result)
    }).catch(() => {
      if (!active) return
      setFontResolution(null)
    }).finally(() => {
      if (active) setFontsReady(true)
    })
    return () => {
      active = false
    }
  }, [document.filePath, document.modifiedUnixMicros, document.fontResources, fallbackFont, retryKey, systemFontFallback, t])

  const runSearch = useCallback(async (handle: OFDViewerHandle | null) => {
    if (!viewerReady || !handle) return
    if (!searchOpen || !searchQuery.trim()) {
      handle.getViewer()?.clearFind()
      onSearchChange(tabId, 0, 0)
      onSearchPendingChange(tabId, false)
      return
    }
    onSearchPendingChange(tabId, true)
    try {
      await handle.find(searchQuery)
    } catch (reason) {
      onSearchPendingChange(tabId, false)
    }
  }, [onSearchChange, onSearchPendingChange, searchOpen, searchQuery, tabId, viewerReady])

  const loadSystemFont = useCallback(async (source: { path: string } | { filePath: string }) => {
    const fontPath = 'path' in source ? source.path : source.filePath
    const match = /^mdstudio-system-font:([0-9a-f-]{36}):(\d{1,3})$/i.exec(fontPath)
    if (!match || !fontResolution || match[1] !== fontResolution.sessionId) return null
    const index = Number(match[2])
    if (!Number.isInteger(index) || !fontResolution.sources.some(font => font.index === index)) return null
    const buffer = await invoke<ArrayBuffer>('read_ofd_system_font', { sessionId: match[1], index })
    const bytes = new Uint8Array(buffer)
    const sessionBytes = fontBytesRef.current.get(match[1]) ?? []
    sessionBytes.push(bytes)
    fontBytesRef.current.set(match[1], sessionBytes)
    return bytes
  }, [fontResolution])

  useEffect(() => {
    const ref = forwardedRef && typeof forwardedRef === 'object' ? forwardedRef.current : null
    void runSearch(ref)
    return () => onSearchPendingChange(tabId, false)
  }, [forwardedRef, onSearchPendingChange, runSearch, tabId])

  return <section className="ofd-reader" aria-label={t('OFD 阅读器')}>
    {error && <div className="ofd-reader-error" role="alert">
      <span>{t('OFD 页面渲染失败：{reason}', { reason: error })}</span>
      <button type="button" onClick={() => {
        setError('')
        setViewerReady(false)
        if (systemFontFallback && document.fontResources.length > 0) setFontsReady(false)
        setRetryKey(key => key + 1)
      }}>{t('重试')}</button>
    </div>}
    <div className="ofd-viewer-host" data-testid="ofd-viewer-host" ref={viewerHostRef}>
      {/* 第三方日文界面资源不完整；其工具栏、侧栏和提示层隐藏，用户可见控件由 MdStudio 本地化。 */}
      {!fontsReady ? <div className="ofd-font-loading" role="status">{t('正在匹配本机字体…')}</div> : <OFDViewer
        key={`${document.filePath}:${document.modifiedUnixMicros}:${retryKey}:${fontResolution?.sessionId ?? 'no-system-fonts'}`}
        ref={setViewerHandle}
        source={document.bytes}
        page={initialPage}
        scale={initialScale}
        rotation={initialRotation as 0 | 90 | 180 | 270}
        theme={dark ? 'dark' : 'light'}
        locale={locale === 'en' ? 'en-US' : 'zh-CN'}
        features={{ toolbar: false, print: false, export: false, verification: false, selection: false, find: true, textLayer: true }}
        featureDisplay="hide"
        maxCanvasPixels={16_000_000}
        maxCanvasDim={8192}
        supersample="off"
        pageCacheSize={4}
        pageCachePixelBudget={48_000_000}
        thumbnailCacheSize={12}
        textSpanBudget={12_000}
        fonts={fontResolution ? {
          supplementary: fontResolution.sources.map(font => ({
            path: `mdstudio-system-font:${fontResolution.sessionId}:${font.index}`,
            family: font.family,
          })),
          aliases: fontResolution.aliases,
          loader: loadSystemFont,
        } : undefined}
        renderConcurrency={1}
        updateHash={false}
        debug={{ console: false }}
        onReady={() => {
          setViewerReady(true)
          setError('')
          restoreScrollPosition(document.filePath)
          onOutlineChange(tabId, viewerHandleRef.current?.getState()?.document.outline ?? [])
        }}
        onDocumentOpen={({ pageCount }) => {
          onPageCountChange(tabId, pageCount)
          onOutlineChange(tabId, viewerHandleRef.current?.getState()?.document.outline ?? [])
        }}
        onPageChange={({ pageNumber }) => {
          setCurrentPage(pageNumber)
          onReadingChange(tabId, pageNumber, currentScale, currentRotation)
        }}
        onScaleChange={({ scale }) => {
          setCurrentScale(scale)
          onReadingChange(tabId, currentPage, scale, currentRotation)
        }}
        onRotationChange={({ rotation }) => {
          setCurrentRotation(rotation)
          onReadingChange(tabId, currentPage, currentScale, rotation)
        }}
        onFindMatches={({ query, total, current }) => {
          if (query.trim() !== searchQuery.trim()) return
          onSearchChange(tabId, total, Math.max(0, current - 1))
          onSearchPendingChange(tabId, false)
        }}
        onError={viewerError => {
          setError(viewerError.message)
        }}
      />}
    </div>
  </section>
}

export const OfdViewer = forwardRef(OfdViewerComponent)
