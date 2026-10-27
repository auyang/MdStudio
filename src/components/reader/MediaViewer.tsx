import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { recordPerformance } from '../../features/reader/performance'
import { useI18n } from '../../features/i18n'

interface SvgViewBox {
  x: number
  y: number
  width: number
  height: number
}

interface MediaView {
  scale: number
  x: number
  y: number
}

export type MediaViewerContent =
  | { kind: 'image'; src: string; alt: string }
  | {
      kind: 'svg'
      source: string
      render: (id: string, shouldContinue: () => boolean) => Promise<string | null>
    }

interface MediaViewerDialogProps {
  content: MediaViewerContent
  triggerRef: RefObject<HTMLElement | null>
  onClose: () => void
}

let nextMediaViewerId = 0
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4

export function readSvgViewBox(svg: SVGSVGElement): SvgViewBox {
  const values = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (values?.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
    return { x: values[0], y: values[1], width: values[2], height: values[3] }
  }

  const numericDimension = (value: string | null) => value && /^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/.test(value.trim())
    ? Number.parseFloat(value)
    : Number.NaN
  const width = numericDimension(svg.getAttribute('width'))
  const height = numericDimension(svg.getAttribute('height'))
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    return { x: 0, y: 0, width, height }
  }

  try {
    const bounds = svg.getBBox()
    if (bounds.width > 0 && bounds.height > 0) {
      svg.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`)
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    }
  } catch {
    // 部分 WebView 在 SVG 完成布局前无法计算 getBBox；此时返回明确错误。
  }
  throw new Error('内容缺少有效尺寸，无法计算缩放视图。')
}

function retrySource(source: string, attempt: number): string {
  if (attempt === 0 || source.startsWith('data:')) return source
  try {
    const url = new URL(source)
    url.searchParams.set('mdstudio-retry', String(attempt))
    return url.toString()
  } catch {
    return source
  }
}

export function MediaViewerDialog({ content, triggerRef, onClose }: MediaViewerDialogProps) {
  const t = useI18n()
  const [viewerId] = useState(() => `mdstudio-media-viewer-${++nextMediaViewerId}`)
  const [attempt, setAttempt] = useState(0)
  const [markup, setMarkup] = useState('')
  const [error, setError] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const [view, setView] = useState<MediaView>({ scale: 1, x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dimensions, setDimensions] = useState<SvgViewBox | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const isSvg = content.kind === 'svg'
  const imageSrc = content.kind === 'image' ? content.src : ''
  const imageAlt = content.kind === 'image' ? content.alt : ''
  const svgSource = content.kind === 'svg' ? content.source : ''
  const renderSvg = content.kind === 'svg' ? content.render : undefined
  const title = isSvg ? t('Mermaid 放大查看') : imageAlt || t('图片放大查看')
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  const onCloseRef = useRef(onClose)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const dragMovedRef = useRef(false)
  const isFittedRef = useRef(true)
  const viewerOpenedAt = useRef(performance.now())
  onCloseRef.current = onClose

  const commitView = (next: MediaView) => {
    viewRef.current = next
    setView(next)
  }

  const fitToViewport = () => {
    const canvas = canvasRef.current
    if (!canvas || !dimensions) return
    const bounds = canvas.getBoundingClientRect()
    const width = bounds.width || canvas.clientWidth
    const height = bounds.height || canvas.clientHeight
    if (width <= 0 || height <= 0) return
    const scale = Math.min(MAX_ZOOM, Math.max(0.01, Math.min(width / dimensions.width, height / dimensions.height)))
    commitView({ scale, x: (width - dimensions.width * scale) / 2, y: (height - dimensions.height * scale) / 2 })
    isFittedRef.current = true
  }

  const showNaturalSize = () => {
    const canvas = canvasRef.current
    if (!canvas || !dimensions) return
    const bounds = canvas.getBoundingClientRect()
    const width = bounds.width || canvas.clientWidth
    const height = bounds.height || canvas.clientHeight
    commitView({ scale: 1, x: Math.max(0, (width - dimensions.width) / 2), y: Math.max(0, (height - dimensions.height) / 2) })
    isFittedRef.current = false
  }

  const zoomAt = (requestedScale: number, clientX?: number, clientY?: number) => {
    const canvas = canvasRef.current
    if (!canvas || !dimensions) return
    const rect = canvas.getBoundingClientRect()
    const current = viewRef.current
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, requestedScale))
    const px = (clientX ?? rect.left + rect.width / 2) - rect.left
    const py = (clientY ?? rect.top + rect.height / 2) - rect.top
    const contentX = (px - current.x) / current.scale
    const contentY = (py - current.y) / current.scale
    commitView({ scale, x: px - contentX * scale, y: py - contentY * scale })
    isFittedRef.current = false
  }

  useEffect(() => {
    recordPerformance('media-viewer-opened', { kind: content.kind })
    return () => recordPerformance('media-viewer-closed', { kind: content.kind })
  }, [])

  useEffect(() => {
    setMarkup('')
    setError('')
    setDimensions(null)
    setImageLoaded(false)
    if (!renderSvg) return
    let disposed = false
    void renderSvg(`${viewerId}-${attempt + 1}`, () => !disposed).then(result => {
      if (!disposed && result) setMarkup(result)
      else if (!disposed && !result) setError('Mermaid 图表渲染已取消。')
    }).catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { disposed = true }
  }, [attempt, renderSvg, viewerId])

  useLayoutEffect(() => {
    if (!markup || !isSvg) return
    const element = contentRef.current?.querySelector('svg')
    if (!element) {
      setError('安全渲染结果中没有 SVG 根节点。')
      return
    }
    try {
      const size = readSvgViewBox(element)
      element.setAttribute('width', `${size.width}px`)
      element.setAttribute('height', `${size.height}px`)
      element.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      element.style.setProperty('width', `${size.width}px`, 'important')
      element.style.setProperty('height', `${size.height}px`, 'important')
      element.style.setProperty('max-width', 'none', 'important')
      element.style.display = 'block'
      setDimensions(size)
      commitView({ scale: 1, x: 0, y: 0 })
      recordPerformance('media-viewer-svg-ready', {
        durationMs: Number((performance.now() - viewerOpenedAt.current).toFixed(3)),
        width: size.width,
        height: size.height,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [isSvg, markup])

  useLayoutEffect(() => {
    if (!imageLoaded || isSvg) return
    const image = contentRef.current?.querySelector('img')
    if (!image?.naturalWidth || !image.naturalHeight) return
    const size = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }
    image.width = size.width
    image.height = size.height
    setDimensions(size)
    commitView({ scale: 1, x: 0, y: 0 })
  }, [attempt, imageLoaded, isSvg])

  useLayoutEffect(() => {
    if (!dimensions) return
    fitToViewport()
    const canvas = canvasRef.current
    if (!canvas) return
    const onResize = () => { if (isFittedRef.current) fitToViewport() }
    window.addEventListener('resize', onResize)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onResize)
    observer?.observe(canvas)
    return () => {
      window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [dimensions, showSource])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onWindowKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onWindowKeyDown)
      window.setTimeout(() => {
        if (triggerRef.current?.isConnected) triggerRef.current.focus()
      }, 0)
    }
  }, [triggerRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !dimensions) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAt(viewRef.current.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [dimensions])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button, a, input, textarea, select')) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: viewRef.current.x, originY: viewRef.current.y }
    dragMovedRef.current = false
    setIsDragging(true)
    event.currentTarget.focus()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 某些测试 WebView 不实现指针捕获。 */ }
    event.preventDefault()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) dragMovedRef.current = true
    commitView({ ...viewRef.current, x: drag.originX + deltaX, y: drag.originY + deltaY })
    isFittedRef.current = false
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setIsDragging(false)
    if (dragMovedRef.current) window.setTimeout(() => { dragMovedRef.current = false }, 0)
  }

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(svgSource)
      setCopyMessage('源码已复制')
    } catch {
      setCopyMessage('无法访问剪贴板，请在源码中手动复制。')
    }
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomAt(viewRef.current.scale * 1.2)
    } else if (event.key === '-') {
      event.preventDefault()
      zoomAt(viewRef.current.scale / 1.2)
    } else if (event.key === '0') {
      event.preventDefault()
      fitToViewport()
    } else if (event.key === 'Tab') {
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? [])
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  const toggleFit = () => {
    if (dragMovedRef.current) return
    if (isFittedRef.current) showNaturalSize()
    else fitToViewport()
  }

  const zoomDisabled = !dimensions
  const imageAttemptSrc = retrySource(imageSrc, attempt)

  return createPortal(
    <div className="reader-mermaid-viewer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="reader-mermaid-viewer" role="dialog" aria-modal="true" aria-labelledby={`${viewerId}-title`} ref={dialogRef} onKeyDown={onKeyDown}>
        <header className="reader-mermaid-viewer-toolbar">
        <strong id={`${viewerId}-title`}>{title}</strong>
          <div className="reader-mermaid-viewer-actions">
            <button type="button" aria-label={t(isSvg ? '缩小图表' : '缩小图片')} title={t('缩小')} disabled={zoomDisabled || view.scale <= MIN_ZOOM} onClick={() => zoomAt(viewRef.current.scale / 1.2)}>−</button>
            <output aria-label={t('当前缩放比例')}>{Math.round(view.scale * 100)}%</output>
            <button type="button" aria-label={t(isSvg ? '放大图表' : '放大图片')} title={t('放大')} disabled={zoomDisabled || view.scale >= MAX_ZOOM} onClick={() => zoomAt(viewRef.current.scale * 1.2)}>+</button>
            <button type="button" onClick={fitToViewport} disabled={zoomDisabled}>{t('适应窗口')}</button>
            <button type="button" title={t('自然像素对 CSS 像素；SVG 视口单位对 CSS 像素')} onClick={showNaturalSize} disabled={zoomDisabled}>{t('100%')}</button>
            <button type="button" onClick={fitToViewport} disabled={zoomDisabled}>{t('重置')}</button>
            {isSvg && <>
              <button type="button" onClick={() => setShowSource(value => !value)}>{t(showSource ? '隐藏源码' : '查看源码')}</button>
              <button type="button" onClick={() => void copySource()}>{t('复制源码')}</button>
            </>}
            <button type="button" ref={closeButtonRef} aria-label={t('关闭放大查看')} onClick={onClose}>{t('关闭')}</button>
          </div>
        </header>
        {error && <div className="reader-mermaid-viewer-error" role="alert">
          <strong>{t(isSvg ? 'Mermaid 流程图渲染失败' : '图片无法显示')}</strong>
          <span>{t(error)}</span>
          <button type="button" onClick={() => { setAttempt(value => value + 1); setError('') }}>{t(isSvg ? '重试渲染' : '重试加载')}</button>
        </div>}
        {!error && (isSvg ? !markup : !imageLoaded) && <div className="reader-mermaid-viewer-loading" role="status">{t(isSvg ? '正在绘制 Mermaid 图表…' : '正在加载图片…')}</div>}
        <div
          className={`reader-mermaid-viewer-canvas${isDragging ? ' is-dragging' : ''}`}
          ref={canvasRef}
          tabIndex={0}
          aria-label={t(isSvg ? 'Mermaid 图表画布，可拖动平移并滚轮缩放' : '图片画布，可拖动平移并滚轮缩放')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={event => { if (!(event.target as Element).closest('button')) toggleFit() }}
        >
          {!error && (isSvg ? markup : imageSrc) && <div
            ref={contentRef}
            className="reader-mermaid-viewer-scene"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              width: dimensions?.width ?? 0,
              height: dimensions?.height ?? 0,
              visibility: dimensions ? 'visible' : 'hidden',
            }}
          >{isSvg ? <div dangerouslySetInnerHTML={{ __html: markup }} /> : <img
            key={attempt}
            src={imageAttemptSrc}
            alt={imageAlt}
            draggable={false}
            decoding="async"
            onLoad={() => {
              setImageLoaded(true)
              setError('')
              const loadedImage = contentRef.current?.querySelector('img')
              recordPerformance('media-viewer-image-ready', {
                durationMs: Number((performance.now() - viewerOpenedAt.current).toFixed(3)),
                naturalWidth: loadedImage?.naturalWidth ?? 0,
                naturalHeight: loadedImage?.naturalHeight ?? 0,
              })
            }}
            onError={() => { setImageLoaded(false); setError('文件可能已移动、删除或无法读取。请检查原始图片后重试。') }}
          />}</div>}
        </div>
        {copyMessage && <div className="reader-mermaid-viewer-status" role="status">{t(copyMessage)}</div>}
        {showSource && isSvg && <pre className="reader-mermaid-viewer-source"><code>{svgSource}</code></pre>}
      </div>
    </div>,
    document.body,
  )
}
