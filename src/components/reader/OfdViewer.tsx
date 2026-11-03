import { OFDViewer } from '@ofdrw/ofdrw-viewer-ui/react'
import type { OFDViewerHandle } from '@ofdrw/ofdrw-viewer-ui/react'
import type { OutlineNode } from '@ofdrw/ofdrw-viewer-ui'
import { invoke } from '@tauri-apps/api/core'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ForwardedRef } from 'react'
import '@ofdrw/ofdrw-viewer-ui/style.css'
import './OfdViewer.css'
import type { AppLocale, OfdFallbackFont } from '../../features/reader/preferences'
import { useI18n } from '../../features/i18n'
import type { OfdReaderDocument } from '../../features/documents/ofd/reader'

type Diagnostic = { code: string; message: string; pageIndex?: number }

type OfdViewerProps = {
  tabId: string
  document: OfdReaderDocument
  locale: AppLocale
  dark: boolean
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
}

function addDiagnostic(current: Diagnostic[], next: Diagnostic): Diagnostic[] {
  const items = [next, ...current.filter(item => item.code !== next.code || item.message !== next.message)]
  return items.slice(0, 8)
}

function diagnosticMessage(item: Diagnostic, locale: AppLocale, t: (source: string, values?: Record<string, string | number>) => string): string {
  if (locale !== 'ja') return item.message
  if (item.code === 'W_FONT_MISSING') return t('OFD 引擎诊断：缺少字体，部分文字可能无法显示。')
  if (item.code === 'W_IMAGE_DECODE') return t('OFD 引擎诊断：图片无法解码。')
  if (item.code === 'W_TEXT_EMPTY') return t('OFD 引擎诊断：没有可搜索的文字。')
  return t('OFD 引擎诊断代码：{code}。请联系支持时提供此代码。', { code: item.code })
}

function OfdViewerComponent({
  document,
  tabId,
  locale,
  dark,
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
}: OfdViewerProps, forwardedRef: ForwardedRef<OFDViewerHandle>) {
  const t = useI18n()
  const [viewerReady, setViewerReady] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [currentScale, setCurrentScale] = useState(initialScale)
  const [currentRotation, setCurrentRotation] = useState(initialRotation)
  const [fontResolution, setFontResolution] = useState<{
    sessionId: string
    sources: Array<{ index: number; family: string; coveredCharacters: number; requiredCharacters: number }>
    aliases: string[][]
    missingFontNames: string[]
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
    setViewerReady(false)
    setDiagnostics([])
    setError('')
    setCurrentPage(initialPage)
    setCurrentScale(initialScale)
    setCurrentRotation(initialRotation)
    onSearchChange(tabId, 0, 0)
  }, [document.filePath, document.modifiedUnixMicros])

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
      missingFontNames: string[]
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
      if (result.missingFontNames.length > 0) {
        setDiagnostics(items => addDiagnostic(items, {
          code: 'SYSTEM_FONT_MISSING',
          message: t('没有找到可用的系统替代字体：{fonts}', { fonts: result.missingFontNames.slice(0, 4).join('、') }),
        }))
      }
    }).catch(reason => {
      if (!active) return
      const message = reason instanceof Error ? reason.message : String(reason)
      setDiagnostics(items => addDiagnostic(items, { code: 'SYSTEM_FONT_SERVICE', message: t('系统字体匹配失败：{reason}', { reason: message }) }))
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
      const message = reason instanceof Error ? reason.message : String(reason)
      setDiagnostics(items => addDiagnostic(items, { code: 'FIND', message }))
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
    {document.hasSignatures && <div className="ofd-signature-notice" role="status">{t('包含签章；签章未验证。')}</div>}
    {locale === 'zh-CN'
      ? document.resourceWarnings.map((warning, index) => <div className="ofd-reader-notice" role="status" key={`${warning}-${index}`}>{t('OFD 资源提示：{warning}', { warning })}</div>)
      : document.resourceWarnings.length > 0 && <div className="ofd-reader-notice" role="status">{t('OFD 文档中有 {count} 项资源无法显示。', { count: document.resourceWarnings.length })}</div>}
    {diagnostics.length > 0 && <div className="ofd-diagnostics" role="status" aria-live="polite">
      <strong>{t('OFD 阅读诊断')}</strong>
      <ul>{diagnostics.map((item, index) => <li key={`${item.code}-${index}`}>
        <code>{item.code}</code>{item.pageIndex === undefined ? '' : ` · ${t('第 {page} 页', { page: item.pageIndex + 1 })}`}: {diagnosticMessage(item, locale, t)}
      </li>)}</ul>
    </div>}
    {error && <div className="ofd-reader-error" role="alert">
      <span>{t('OFD 页面渲染失败：{reason}', { reason: error })}</span>
      <button type="button" onClick={() => {
        setError('')
        setDiagnostics([])
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
          if (pageCount !== document.pageCount) {
            setDiagnostics(items => addDiagnostic(items, {
              code: 'PAGE_COUNT_MISMATCH',
              message: t('OFD 校验页数与阅读器识别页数不一致。'),
            }))
          }
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
        onWarning={warning => setDiagnostics(items => addDiagnostic(items, {
          code: warning.code,
          message: warning.message,
          pageIndex: warning.pageIndex,
        }))}
        onError={viewerError => {
          const diagnostic = {
            code: viewerError.code,
            message: viewerError.message,
            pageIndex: viewerError.pageIndex,
          }
          setDiagnostics(items => addDiagnostic(items, diagnostic))
          setError(diagnosticMessage(diagnostic, locale, t))
        }}
      />}
    </div>
  </section>
}

export const OfdViewer = forwardRef(OfdViewerComponent)
