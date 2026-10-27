import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { drawSearchFallback } from '../../features/reader/documentSearch'
import type { DocumentSearchMatch } from '../../features/reader/documentSearch'

type SearchHighlightCanvasProps = {
  matches: DocumentSearchMatch[]
  currentIndex: number
  dark: boolean
  articleRef: RefObject<HTMLElement | null>
}

/** 仅在 WebView 不支持 CSS Custom Highlight API 时显示，不写入或包裹正文 DOM。 */
export function SearchHighlightCanvas({ matches, currentIndex, dark, articleRef }: SearchHighlightCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const article = articleRef.current
    if (!canvas || !article) return
    let frame = 0
    const draw = () => {
      frame = 0
      const top = document.querySelector<HTMLElement>('.reader-topbar')?.getBoundingClientRect().bottom ?? 0
      const bottom = document.querySelector<HTMLElement>('.reader-footer')?.getBoundingClientRect().top ?? window.innerHeight
      drawSearchFallback(canvas, matches, currentIndex, {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: window.innerHeight,
        top,
        bottom,
        pixelRatio: window.devicePixelRatio || 1,
      }, dark)
    }
    const scheduleDraw = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(draw)
    }

    draw()
    window.addEventListener('scroll', scheduleDraw, { passive: true, capture: true })
    window.addEventListener('resize', scheduleDraw, { passive: true })
    article.addEventListener('scroll', scheduleDraw, { passive: true, capture: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleDraw)
    observer?.observe(article)
    document.fonts?.addEventListener?.('loadingdone', scheduleDraw)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleDraw, true)
      window.removeEventListener('resize', scheduleDraw)
      article.removeEventListener('scroll', scheduleDraw, true)
      observer?.disconnect()
      document.fonts?.removeEventListener?.('loadingdone', scheduleDraw)
    }
  }, [articleRef, currentIndex, dark, matches])

  return <canvas ref={canvasRef} className="reader-search-fallback-canvas" aria-hidden="true" />
}
