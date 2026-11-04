import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ForwardedRef } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, PageViewport, TextLayer } from 'pdfjs-dist'
import type { AppLocale, ReadingWidth } from '../../features/reader/preferences'
import { translate } from '../../features/i18n'
import type { PdfReaderDocument } from '../../features/documents/pdf/reader'
import './PdfViewer.css'

export type PdfSearchMatch = { pageNumber: number; itemIndex: number; offset: number; length: number }

type PdfViewerProps = {
  tabId: string
  document: PdfReaderDocument
  locale: AppLocale
  dark: boolean
  readingWidth?: ReadingWidth
  initialPage: number
  initialScale: number
  initialRotation: number
  searchOpen: boolean
  searchQuery: string
  searchIndex: number
  onReadingChange: (tabId: string, page: number, scale: number, rotation: number) => void
  onSearchCountChange: (tabId: string, count: number) => void
  onSearchPendingChange: (tabId: string, pending: boolean) => void
}

export type PdfViewerHandle = {
  goToPage: (page: number) => void
  zoomIn: () => void
  zoomOut: () => void
  fitWidth: () => void
  fitHeight: () => void
  fitPage: () => void
  rotate: () => void
  resetZoom: () => void
}

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const SCALE_STEP = 0.1
const MAX_PAGE_CANVAS_AREA = 4_000_000
const EMPTY_PDF_MATCHES: PdfSearchMatch[] = []

function countMatches(text: string, query: string): number {
  if (!query) return 0
  let count = 0
  let start = 0
  const haystack = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  while (start <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, start)
    if (index < 0) break
    count += 1
    start = index + Math.max(1, needle.length)
  }
  return count
}

async function indexPdfText(
  pdf: PDFDocumentProxy,
  query: string,
  signal: AbortSignal,
): Promise<{ matches: PdfSearchMatch[]; hasText: boolean }> {
  const matches: PdfSearchMatch[] = []
  let hasText = false
  const needle = query.toLocaleLowerCase()
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError')
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const items = content.items.filter(item => 'str' in item) as Array<{ str: string }>
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const text = items[itemIndex].str
      if (text.trim()) hasText = true
      const lower = text.toLocaleLowerCase()
      let offset = 0
      while (offset <= lower.length - needle.length) {
        const matchOffset = lower.indexOf(needle, offset)
        if (matchOffset < 0) break
        matches.push({ pageNumber, itemIndex, offset: matchOffset, length: query.length })
        offset = matchOffset + Math.max(1, needle.length)
      }
    }
  }
  return { matches, hasText }
}

function splitMatchedText(text: string, matches: PdfSearchMatch[], pageNumber: number, firstGlobalIndex: number, currentIndex: number): Node[] {
  const nodes: Node[] = []
  let offset = 0
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const start = Math.max(offset, Math.min(text.length, match.offset))
    const end = Math.max(start, Math.min(text.length, match.offset + match.length))
    if (start > offset) nodes.push(document.createTextNode(text.slice(offset, start)))
    if (end > start) {
      const mark = document.createElement('mark')
      mark.className = 'pdf-search-match'
      const globalIndex = firstGlobalIndex + index
      mark.dataset.pdfMatchIndex = String(globalIndex)
      mark.setAttribute('aria-label', `${globalIndex + 1}`)
      mark.textContent = text.slice(start, end)
      if (globalIndex === currentIndex) mark.classList.add('is-current')
      nodes.push(mark)
      offset = end
    }
  }
  if (offset < text.length) nodes.push(document.createTextNode(text.slice(offset)))
  if (!nodes.length) nodes.push(document.createTextNode(text))
  void pageNumber
  return nodes
}

type PdfPageProps = {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  rotation: number
  nearViewport: boolean
  matches: PdfSearchMatch[]
  firstGlobalIndex: number
  currentMatchIndex: number
  registerPage: (pageNumber: number, element: HTMLDivElement | null) => void
  onPageError: (message: string) => void
}

const PdfPage = memo(function PdfPage({ pdf, pageNumber, scale, rotation, nearViewport, matches, firstGlobalIndex, currentMatchIndex, registerPage, onPageError }: PdfPageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [rendered, setRendered] = useState(false)
  const setWrapper = useCallback((element: HTMLDivElement | null) => {
    wrapperRef.current = element
    registerPage(pageNumber, element)
  }, [pageNumber, registerPage])

  useEffect(() => setVisible(nearViewport), [nearViewport])

  useEffect(() => {
    if (!visible) {
      setRendered(false)
      setViewport(null)
      const canvas = canvasRef.current
      if (canvas) { canvas.width = 0; canvas.height = 0 }
      if (textRef.current) textRef.current.replaceChildren()
      return
    }
    let cancelled = false
    let page: PDFPageProxy | undefined
    let renderTask: ReturnType<PDFPageProxy['render']> | undefined
    let textLayer: TextLayer | undefined
    setRendered(false)
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        page = await pdf.getPage(pageNumber)
        if (cancelled) return
        const pageViewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
        setViewport(pageViewport)
        const canvas = canvasRef.current
        const textContainer = textRef.current
        if (!canvas || !textContainer) return
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('无法创建 PDF 页面画布。')
        const deviceScale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PAGE_CANVAS_AREA / Math.max(1, pageViewport.width * pageViewport.height)))
        canvas.width = Math.max(1, Math.floor(pageViewport.width * deviceScale))
        canvas.height = Math.max(1, Math.floor(pageViewport.height * deviceScale))
        canvas.style.width = `${pageViewport.width}px`
        canvas.style.height = `${pageViewport.height}px`
        textContainer.style.width = `${pageViewport.width}px`
        textContainer.style.height = `${pageViewport.height}px`
        textContainer.style.setProperty('--scale-factor', String(pageViewport.scale))
        textContainer.style.setProperty('--user-unit', '1')
        textContainer.style.setProperty('--total-scale-factor', String(pageViewport.scale))
        // TextLayer.render 会向容器追加节点；先移除旧视口的文本坐标和高亮，避免旋转/缩放后叠层错位。
        textContainer.replaceChildren()
        renderTask = page.render({ canvas, canvasContext: context, viewport: pageViewport, transform: deviceScale === 1 ? undefined : [deviceScale, 0, 0, deviceScale, 0, 0] })
        await renderTask.promise
        if (cancelled) return
        const content = await page.getTextContent()
        const items = content.items.filter(item => 'str' in item) as Array<{ str: string }>
        textLayer = new pdfjs.TextLayer({ textContentSource: content, container: textContainer, viewport: pageViewport })
        await textLayer.render()
        if (cancelled) return
        const textDivs = textLayer.textDivs
        const grouped = new Map<number, PdfSearchMatch[]>()
        matches.forEach(match => {
          if (match.pageNumber !== pageNumber) return
          const list = grouped.get(match.itemIndex) ?? []
          list.push(match)
          grouped.set(match.itemIndex, list)
        })
        for (const [itemIndex, itemMatches] of grouped) {
          const textDiv = textDivs[itemIndex]
          const source = items[itemIndex]?.str ?? ''
          if (!textDiv || !source) continue
          const firstIndex = firstGlobalIndex + matches.filter(match => match.pageNumber === pageNumber && match.itemIndex < itemIndex).length
          textDiv.replaceChildren(...splitMatchedText(source, itemMatches, pageNumber, firstIndex, -1))
        }
        setRendered(true)
      } catch (reason) {
        if (!cancelled && !(reason instanceof DOMException && reason.name === 'RenderingCancelledException')) {
          onPageError(reason instanceof Error ? reason.message : String(reason))
        }
      }
    })()
    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      page?.cleanup()
    }
  }, [firstGlobalIndex, matches, onPageError, pageNumber, pdf, rotation, scale, visible])

  useEffect(() => {
    if (!rendered || !wrapperRef.current) return
    wrapperRef.current.querySelectorAll<HTMLElement>('[data-pdf-match-index]').forEach(mark => {
      mark.classList.toggle('is-current', Number(mark.dataset.pdfMatchIndex) === currentMatchIndex)
    })
    if (!matches.some(match => match.pageNumber === pageNumber)) return
    const firstGlobal = firstGlobalIndex
    const localIndex = currentMatchIndex - firstGlobal
    if (localIndex < 0 || localIndex >= matches.filter(match => match.pageNumber === pageNumber).length) return
    const mark = wrapperRef.current.querySelector(`[data-pdf-match-index="${currentMatchIndex}"]`)
    mark?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentMatchIndex, firstGlobalIndex, matches, pageNumber, rendered])

  const estimatedHeight = viewport?.height ?? Math.max(500, Math.min(1400, scale * 792))
  return <div ref={setWrapper} className="pdf-page-wrap" data-page-number={pageNumber} style={{ minWidth: viewport ? `${viewport.width}px` : undefined }}>
    <div className="pdf-page-number">{pageNumber}</div>
    <div className="pdf-page" style={{ width: viewport?.width ?? 'min(100%, 820px)', height: estimatedHeight }}>
      <canvas ref={canvasRef} className="pdf-page-canvas" aria-label={`PDF 第 ${pageNumber} 页`} />
      <div ref={textRef} className="textLayer pdf-text-layer" aria-label={`PDF 第 ${pageNumber} 页文本`} />
      {nearViewport && !rendered && <div className="pdf-page-loading">正在绘制第 {pageNumber} 页…</div>}
    </div>
  </div>
})

function PdfViewerComponent({ tabId, document, locale, dark, readingWidth = 'wide', initialPage, initialScale, initialRotation, searchOpen, searchQuery, searchIndex, onReadingChange, onSearchCountChange, onSearchPendingChange }: PdfViewerProps, forwardedRef: ForwardedRef<PdfViewerHandle>) {
  const t = useCallback((value: string, parameters?: Record<string, string | number>) => translate(locale, value, parameters), [locale])
  const clampPage = useCallback((value: number) => Math.max(1, Math.min(document.pageCount, Math.trunc(value) || 1)), [document.pageCount])
  const initialPositionRef = useRef({ document, page: clampPage(initialPage) })
  if (initialPositionRef.current.document !== document) initialPositionRef.current = { document, page: clampPage(initialPage) }
  const [page, setPage] = useState(initialPositionRef.current.page)
  const [scale, setScale] = useState(Math.max(MIN_SCALE, Math.min(MAX_SCALE, initialScale)))
  const [rotation, setRotation] = useState(((initialRotation % 360) + 360) % 360)
  const [nearPages, setNearPages] = useState<Set<number>>(() => new Set([1, Math.max(1, initialPage)]))
  const previousReadingWidthRef = useRef(readingWidth)
  const pendingWidthFitRef = useRef(false)
  const [searchMatches, setSearchMatches] = useState<PdfSearchMatch[]>([])
  const [hasText, setHasText] = useState(true)
  const [pageError, setPageError] = useState('')
  const viewerRef = useRef<HTMLDivElement>(null)
  const pageElementsRef = useRef(new Map<number, HTMLDivElement>())
  const nearbyObserverRef = useRef<IntersectionObserver | null>(null)
  const visibleObserverRef = useRef<IntersectionObserver | null>(null)
  const visibleRatiosRef = useRef(new Map<number, number>())

  const registerPage = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    if (element) {
      pageElementsRef.current.set(pageNumber, element)
      nearbyObserverRef.current?.observe(element)
      visibleObserverRef.current?.observe(element)
      return
    }
    const previous = pageElementsRef.current.get(pageNumber)
    if (previous) {
      nearbyObserverRef.current?.unobserve(previous)
      visibleObserverRef.current?.unobserve(previous)
    }
    pageElementsRef.current.delete(pageNumber)
    visibleRatiosRef.current.delete(pageNumber)
  }, [])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setNearPages(new Set([1, Math.max(1, initialPage)]))
      return
    }
    const nearby = new IntersectionObserver(entries => {
      setNearPages(current => {
        const next = new Set(current)
        for (const entry of entries) {
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber)
          if (!Number.isFinite(pageNumber)) continue
          if (entry.isIntersecting) next.add(pageNumber)
          else next.delete(pageNumber)
        }
        return next.size === current.size && [...next].every(value => current.has(value)) ? current : next
      })
    }, { rootMargin: '600px 0px', threshold: 0 })
    const visible = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber)
        if (!Number.isFinite(pageNumber)) continue
        visibleRatiosRef.current.set(pageNumber, entry.isIntersecting ? entry.intersectionRatio : 0)
      }
      let bestPage = 0
      let bestRatio = 0
      for (const [pageNumber, ratio] of visibleRatiosRef.current) {
        if (ratio > bestRatio) { bestRatio = ratio; bestPage = pageNumber }
      }
      if (bestRatio > 0.05 && bestPage > 0) setPage(bestPage)
    }, { threshold: [0, 0.25, 0.5, 0.75] })
    nearbyObserverRef.current = nearby
    visibleObserverRef.current = visible
    for (const element of pageElementsRef.current.values()) { nearby.observe(element); visible.observe(element) }
    return () => {
      nearby.disconnect()
      visible.disconnect()
      nearbyObserverRef.current = null
      visibleObserverRef.current = null
      visibleRatiosRef.current.clear()
    }
  }, [document.pageCount])

  const pageMatches = useMemo(() => {
    const map = new Map<number, PdfSearchMatch[]>()
    for (const match of searchMatches) {
      const list = map.get(match.pageNumber) ?? []
      list.push(match)
      map.set(match.pageNumber, list)
    }
    return map
  }, [searchMatches])
  const pageMatchStarts = useMemo(() => {
    const starts = new Map<number, number>()
    let total = 0
    for (let pageNumber = 1; pageNumber <= document.pageCount; pageNumber += 1) {
      starts.set(pageNumber, total)
      total += pageMatches.get(pageNumber)?.length ?? 0
    }
    return starts
  }, [document.pageCount, pageMatches])

  useEffect(() => {
    setPage(Math.max(1, Math.min(document.pageCount, initialPage)))
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, initialScale)))
    setRotation(((initialRotation % 360) + 360) % 360)
    setNearPages(new Set([1, Math.max(1, initialPage)]))
    setSearchMatches([])
    setPageError('')
  }, [document])

  useEffect(() => {
    onReadingChange(tabId, page, scale, rotation)
  }, [onReadingChange, page, rotation, scale, tabId])

  const reportPageError = useCallback((message: string) => setPageError(message), [])
  const scrollToPage = useCallback((pageNumber: number, behavior: ScrollBehavior = 'smooth') => {
    viewerRef.current?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`)?.scrollIntoView({ block: 'start', behavior })
  }, [])

  useEffect(() => {
    scrollToPage(initialPositionRef.current.page, 'auto')
  }, [document, scrollToPage])

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchMatches([])
      setHasText(true)
      onSearchCountChange(tabId, 0)
      onSearchPendingChange(tabId, false)
      return
    }
    const controller = new AbortController()
    let current = true
    onSearchPendingChange(tabId, true)
    void indexPdfText(document.pdfDocument, searchQuery.trim(), controller.signal).then(result => {
      if (!current || controller.signal.aborted) return
      setSearchMatches(result.matches)
      setHasText(result.hasText)
      onSearchCountChange(tabId, result.matches.length)
      onSearchPendingChange(tabId, false)
    }).catch(reason => {
      if (!current || controller.signal.aborted) return
      setSearchMatches([])
      onSearchCountChange(tabId, 0)
      onSearchPendingChange(tabId, false)
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setPageError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false; controller.abort() }
  }, [document, onSearchCountChange, onSearchPendingChange, searchOpen, searchQuery, tabId])

  useEffect(() => {
    if (!searchMatches.length) return
    const match = searchMatches[((searchIndex % searchMatches.length) + searchMatches.length) % searchMatches.length]
    setPage(match.pageNumber)
    scrollToPage(match.pageNumber)
  }, [scrollToPage, searchIndex, searchMatches])

  const goToPage = useCallback((nextPage: number) => {
    const safePage = Math.max(1, Math.min(document.pageCount, Math.trunc(nextPage) || 1))
    setPage(safePage)
    scrollToPage(safePage)
  }, [document.pageCount, scrollToPage])

  const fitScale = useCallback(async (mode: 'width' | 'height' | 'page') => {
    const container = viewerRef.current
    if (!container) return
    const pdfPage = await document.pdfDocument.getPage(page)
    const natural = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + rotation) % 360 })
    const widthScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (container.clientWidth - 48) / natural.width))
    const viewport = container.querySelector<HTMLElement>('.pdf-viewer-scroll')
    const heightScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, ((viewport?.clientHeight ?? container.clientHeight) - 52) / natural.height))
    setScale(mode === 'width' ? widthScale : mode === 'height' ? heightScale : Math.min(widthScale, heightScale))
  }, [document.pdfDocument, page, rotation])

  useEffect(() => {
    if (previousReadingWidthRef.current !== readingWidth) {
      previousReadingWidthRef.current = readingWidth
      pendingWidthFitRef.current = true
    }
    if (!pendingWidthFitRef.current) return
    const frame = requestAnimationFrame(() => {
      pendingWidthFitRef.current = false
      void fitScale(readingWidth === 'fit' ? 'page' : 'width')
    })
    return () => cancelAnimationFrame(frame)
  }, [fitScale, readingWidth])

  useImperativeHandle(forwardedRef, () => ({
    goToPage,
    zoomIn: () => setScale(value => Math.min(MAX_SCALE, Math.round((value + SCALE_STEP) * 100) / 100)),
    zoomOut: () => setScale(value => Math.max(MIN_SCALE, Math.round((value - SCALE_STEP) * 100) / 100)),
    fitWidth: () => { void fitScale('width') },
    fitHeight: () => { void fitScale('height') },
    fitPage: () => { void fitScale('page') },
    rotate: () => setRotation(value => (value + 90) % 360),
    resetZoom: () => setScale(1),
  }), [goToPage, fitScale])

  const pages = useMemo(() => Array.from({ length: document.pageCount }, (_, index) => index + 1), [document.pageCount])

  return <section className={`pdf-reader${dark ? ' is-dark' : ''}`} ref={viewerRef} aria-label={t('PDF 阅读器')}>
    <div className="pdf-viewer-scroll" aria-label={t('PDF 连续页面')}>
      {pages.map(pageNumber => <div key={`${document.filePath}:${pageNumber}`}>
        <PdfPage
          pdf={document.pdfDocument}
          pageNumber={pageNumber}
          scale={scale}
          rotation={rotation}
          nearViewport={nearPages.has(pageNumber)}
          matches={pageMatches.get(pageNumber) ?? EMPTY_PDF_MATCHES}
          firstGlobalIndex={pageMatchStarts.get(pageNumber) ?? 0}
          currentMatchIndex={searchMatches.length ? ((searchIndex % searchMatches.length) + searchMatches.length) % searchMatches.length : -1}
          registerPage={registerPage}
          onPageError={reportPageError}
        />
      </div>)}
    </div>
    {searchOpen && searchQuery.trim() && !hasText && <div className="pdf-reader-notice" role="status">{t('此 PDF 未检测到可搜索文字，可能是扫描件；MdStudio 暂不提供 OCR。')}</div>}
    {pageError && <div className="pdf-reader-error" role="alert">{t('PDF 页面渲染失败：{reason}', { reason: pageError })}</div>}
  </section>
}

export const PdfViewer = forwardRef(PdfViewerComponent)

export { countMatches }
