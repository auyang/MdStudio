import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OFDViewerHandle } from '@ofdrw/ofdrw-viewer-ui/react'
import type { OutlineNode } from '@ofdrw/ofdrw-viewer-ui'
import type { CSSProperties } from 'react'
import type { AppLocale } from '../../features/reader/preferences'
import { translate, useI18n } from '../../features/i18n'
import type { PdfOutlineItem } from '../../features/documents/pdf/reader'

type OutlineRow = { title: string; depth: number; page?: number; key: string; target?: PdfOutlineItem['dest'] }

type DocumentNavigationPanelProps = {
  documentType: 'pdf' | 'ofd'
  locale: AppLocale
  page: number
  pageCount: number
  pdfDocument?: PDFDocumentProxy
  pdfOutline?: PdfOutlineItem[]
  ofdOutline?: readonly OutlineNode[]
  ofdViewer?: OFDViewerHandle | null
  onPageChange: (page: number) => void
  onClose: () => void
}

function flattenOutline(items: readonly OutlineNode[], depth = 1, prefix = 'outline'): OutlineRow[] {
  const rows: OutlineRow[] = []
  for (const [index, item] of items.entries()) {
    if (rows.length >= 1000) break
    const destination = item.dest
    const page = Number.isInteger(destination?.pageIndex) ? Number(destination?.pageIndex) + 1 : undefined
    rows.push({ title: item.title, depth, page, key: `${prefix}-${index}` })
    if (item.children?.length) {
      rows.push(...flattenOutline(item.children, Math.min(depth + 1, 6), `${prefix}-${index}`))
    }
    if (rows.length >= 1000) break
  }
  return rows
}

function PdfThumbnail({ pdf, pageNumber, locale, onClick }: { pdf: PDFDocumentProxy; pageNumber: number; locale: AppLocale; onClick: () => void }) {
  const t = useCallback((source: string) => translate(locale, source), [locale])
  const [error, setError] = useState(false)
  const [ready, setReady] = useState(false)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<import('pdfjs-dist').PDFPageProxy['render']> | undefined
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled || !canvas) return
        const natural = page.getViewport({ scale: 1 })
        const scale = Math.min(112 / Math.max(1, natural.width), 88 / Math.max(1, natural.height), 1)
        const viewport = page.getViewport({ scale })
        const ratio = Math.min(2, window.devicePixelRatio || 1)
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('canvas unavailable')
        task = page.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
        await task.promise
        if (!cancelled) setReady(true)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => { cancelled = true; task?.cancel(); if (canvas) { canvas.width = 0; canvas.height = 0 } }
  }, [canvas, pageNumber, pdf])

  return <button type="button" className="document-thumbnail" onClick={onClick} aria-label={t('跳转到第 {page} 页') .replace('{page}', String(pageNumber))}>
    <span className="document-thumbnail-page">{pageNumber}</span>
    <span className="document-thumbnail-canvas">{error ? <span className="document-thumbnail-error">—</span> : <canvas ref={setCanvas} className={ready ? 'is-ready' : ''} />}</span>
  </button>
}

function OfdThumbnail({ viewer, pageNumber, locale, onClick }: { viewer: OFDViewerHandle; pageNumber: number; locale: AppLocale; onClick: () => void }) {
  const t = useCallback((source: string) => translate(locale, source), [locale])
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    let objectUrl = ''
    const controller = new AbortController()
    void viewer.exportImage({ page: pageNumber, dpi: 24, format: 'png', signal: controller.signal }).then(result => {
      if (!active || !result) return
      objectUrl = URL.createObjectURL(result.blob)
      setUrl(objectUrl)
    }).catch(() => undefined)
    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [pageNumber, viewer])
  return <button type="button" className="document-thumbnail" onClick={onClick} aria-label={t('跳转到第 {page} 页').replace('{page}', String(pageNumber))}>
    <span className="document-thumbnail-page">{pageNumber}</span>
    <span className="document-thumbnail-canvas">{url ? <img src={url} alt="" /> : <span className="document-thumbnail-error">…</span>}</span>
  </button>
}

export function DocumentNavigationPanel({ documentType, locale, page, pageCount, pdfDocument, pdfOutline = [], ofdOutline: suppliedOfdOutline, ofdViewer, onPageChange, onClose }: DocumentNavigationPanelProps) {
  const t = useI18n()
  const [view, setView] = useState<'thumbnails' | 'outline'>('thumbnails')
  const [resolvedPdfOutline, setResolvedPdfOutline] = useState<OutlineRow[]>([])
  const ofdOutline = suppliedOfdOutline ?? ofdViewer?.getState()?.document.outline ?? []
  const outlineRows = useMemo(() => documentType === 'ofd' ? flattenOutline(ofdOutline) : resolvedPdfOutline, [documentType, ofdOutline, resolvedPdfOutline])
  const [outlinePending, setOutlinePending] = useState(false)
  const start = Math.max(1, page - 2)
  const end = Math.min(pageCount, page + 2)
  const thumbnailPages = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index)

  useEffect(() => setView('thumbnails'), [documentType, pdfDocument, ofdViewer])

  useEffect(() => {
    if (documentType !== 'pdf' || !pdfDocument || !pdfOutline.length) {
      setResolvedPdfOutline([])
      setOutlinePending(false)
      return
    }
    let active = true
    setOutlinePending(true)
    const resolve = async () => {
      const rows: OutlineRow[] = []
      const visit = async (items: readonly PdfOutlineItem[], depth = 1, prefix = 'pdf') => {
        for (const [index, item] of items.entries()) {
          if (!active || rows.length >= 1000) return
          let targetPage: number | undefined
          try {
            const destination = typeof item.dest === 'string' ? await pdfDocument.getDestination(item.dest) : item.dest
            const reference = Array.isArray(destination) ? destination[0] : null
            if (typeof reference === 'number') targetPage = reference + 1
            else if (reference) targetPage = await pdfDocument.getPageIndex(reference as Parameters<PDFDocumentProxy['getPageIndex']>[0]) + 1
          } catch { /* 无效的 PDF 书签仍显示标题，但不提供跳转。 */ }
          rows.push({ title: item.title, depth, page: targetPage, key: `${prefix}-${index}`, target: item.dest })
          if (item.items?.length) await visit(item.items, Math.min(depth + 1, 6), `${prefix}-${index}`)
        }
      }
      await visit(pdfOutline)
      if (active) {
        setResolvedPdfOutline(rows)
        setOutlinePending(false)
      }
    }
    void resolve()
    return () => { active = false }
  }, [documentType, pdfDocument, pdfOutline])

  const openOutline = async (row: OutlineRow) => {
    if (row.page) onPageChange(Math.min(pageCount, Math.max(1, row.page)))
    else if (documentType === 'pdf') {
      try {
        const destination = typeof row.target === 'string' ? await pdfDocument?.getDestination(row.target) : row.target
        const reference = Array.isArray(destination) ? destination[0] : null
        if (typeof reference === 'number') onPageChange(reference + 1)
        else if (reference && pdfDocument) onPageChange(await pdfDocument.getPageIndex(reference as Parameters<PDFDocumentProxy['getPageIndex']>[0]) + 1)
      } catch { /* 书签解析失败时保留导航面板，不影响页面阅读。 */ }
    }
    onClose()
  }

  const hasOutline = outlineRows.length > 0 || (documentType === 'pdf' && pdfOutline.length > 0)
  return <aside className="toc-popover document-navigation-panel" aria-label={t('页面导航')}>
    <div className="popover-heading"><strong>{t('页面导航')}</strong><button className="icon-button compact" onClick={onClose} aria-label={t('关闭目录')}><span aria-hidden="true">×</span></button></div>
    {hasOutline && <div className="document-navigation-tabs" role="tablist" aria-label={t('导航视图')}>
      <button type="button" role="tab" aria-selected={view === 'thumbnails'} className={view === 'thumbnails' ? 'is-selected' : ''} onClick={() => setView('thumbnails')}>{t('缩略图')}</button>
      <button type="button" role="tab" aria-selected={view === 'outline'} className={view === 'outline' ? 'is-selected' : ''} onClick={() => setView('outline')}>{t('大纲')}</button>
    </div>}
    {view === 'outline' && hasOutline ? <nav className="document-outline-list" aria-label={t('大纲')}>
      {outlinePending ? <p className="empty-toc">{t('正在读取大纲…')}</p> : outlineRows.length ? outlineRows.map(row => <button key={row.key} type="button" className="toc-item document-outline-item" style={{ '--toc-level': row.depth } as CSSProperties} disabled={!row.page && !row.target} onClick={() => { void openOutline(row) }} title={row.title}>{row.title}{row.page ? <span>{row.page}</span> : null}</button>) : <p className="empty-toc">{t('未找到可跳转的大纲项。')}</p>}
    </nav> : <div className="document-thumbnail-list" aria-label={t('缩略图')}>
      {thumbnailPages.map(pageNumber => <div key={pageNumber} className={pageNumber === page ? 'is-current' : ''}>
        {pdfDocument ? <PdfThumbnail pdf={pdfDocument} pageNumber={pageNumber} locale={locale} onClick={() => { onPageChange(pageNumber); onClose() }} />
          : ofdViewer ? <OfdThumbnail viewer={ofdViewer} pageNumber={pageNumber} locale={locale} onClick={() => { onPageChange(pageNumber); onClose() }} />
            : null}
      </div>)}
      {!thumbnailPages.length && <p className="empty-toc">{t('暂无页面缩略图。')}</p>}
    </div>}
  </aside>
}
