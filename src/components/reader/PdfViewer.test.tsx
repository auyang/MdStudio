// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfViewer } from './PdfViewer'
import type { PdfViewerHandle } from './PdfViewer'
import type { PdfReaderDocument } from '../../features/documents/pdf/reader'

const pdfjsState = vi.hoisted(() => ({ text: 'PDF text PDF', textLayers: [] as HTMLElement[][] }))

vi.mock('pdfjs-dist', () => ({
  TextLayer: class {
    readonly textDivs: HTMLElement[] = []
    readonly textContentItemsStr: string[] = []
    constructor({ container, textContentSource }: { container: HTMLElement; textContentSource: { items: Array<{ str: string }> } }) {
      for (const item of textContentSource.items) {
        const span = document.createElement('span')
        span.textContent = item.str
        this.textDivs.push(span)
        this.textContentItemsStr.push(item.str)
        container.append(span)
      }
      pdfjsState.textLayers.push(this.textDivs)
    }
    async render() {}
    cancel() {}
    update() {}
  },
}))

let host: HTMLDivElement
let root: Root
let oldObserver: typeof IntersectionObserver | undefined

function mockPdfDocument(): PdfReaderDocument {
  const page = {
    rotate: 0,
    getViewport: ({ scale, rotation }: { scale: number; rotation: number }) => ({ width: 595 * scale, height: 842 * scale, scale, rotation }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    getTextContent: vi.fn(async () => ({ items: [{ str: pdfjsState.text }] })),
    cleanup: vi.fn(),
  }
  const pdfDocument = {
    numPages: 2,
    getPage: vi.fn(async () => page),
  }
  return {
    documentType: 'pdf',
    filePath: '/tmp/fixture.pdf',
    fileName: 'fixture.pdf',
    byteSize: 1024,
    modifiedUnixMicros: 1700000000000000,
    pageCount: 2,
    pdfDocument: pdfDocument as unknown as PdfReaderDocument['pdfDocument'],
    outline: [],
  }
}

describe('PDF 阅读器界面', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    pdfjsState.textLayers = []
    oldObserver = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = class {
      private target: Element | null = null
      constructor(private readonly callback: IntersectionObserverCallback, private readonly options?: IntersectionObserverInit) {}
      observe(target: Element) {
        this.target = target
        queueMicrotask(() => this.callback([{
          target,
          isIntersecting: this.options?.rootMargin ? true : target.getAttribute('data-page-number') === '1',
          intersectionRatio: this.options?.rootMargin ? 1 : target.getAttribute('data-page-number') === '1' ? 1 : 0,
        } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
      }
      unobserve() {}
      disconnect() { this.target = null }
      takeRecords() { return [] }
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    Element.prototype.scrollIntoView = vi.fn()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    host.remove()
    globalThis.IntersectionObserver = oldObserver as typeof IntersectionObserver
    vi.restoreAllMocks()
  })

  it('显示连续页面导航、缩放和旋转，并使用 PDF 文本层搜索', async () => {
    const document = mockPdfDocument()
    const ref = { current: null as PdfViewerHandle | null }
    const onReadingChange = vi.fn()
    const onSearchCountChange = vi.fn()
    const onSearchPendingChange = vi.fn()
    await act(async () => {
      root.render(<PdfViewer
        ref={ref}
        tabId="pdf-tab"
        document={document}
        locale="zh-CN"
        dark={false}
        initialPage={1}
        initialScale={1}
        initialRotation={0}
        searchOpen
        searchQuery="PDF"
        searchIndex={0}
        onReadingChange={onReadingChange}
        onSearchCountChange={onSearchCountChange}
        onSearchPendingChange={onSearchPendingChange}
      />)
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    await act(async () => vi.waitFor(() => expect(host.querySelectorAll('.pdf-search-match').length).toBeGreaterThan(0)))

    expect(host.querySelectorAll('.pdf-page-wrap')).toHaveLength(2)
    expect(host.querySelector('.pdf-toolbar')).toBeNull()
    expect(host.querySelector('.pdf-page-input-label')).toBeNull()
    expect(onSearchCountChange).toHaveBeenCalledWith('pdf-tab', 4)
    expect(host.querySelectorAll('.pdf-search-match').length).toBeGreaterThan(0)
    expect(document.pdfDocument.getPage).toHaveBeenCalled()

    await act(async () => ref.current?.rotate())
    const firstTextLayer = host.querySelector<HTMLElement>('.pdf-text-layer')!
    await act(async () => vi.waitFor(() => expect(firstTextLayer.children).toHaveLength(1)))
    expect(onReadingChange).toHaveBeenCalledWith('pdf-tab', expect.any(Number), expect.any(Number), 90)

    await act(async () => ref.current?.goToPage(2))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('重新挂载时滚动到该标签保存的 PDF 页码', async () => {
    const document = mockPdfDocument()
    await act(async () => {
      root.render(<PdfViewer
        tabId="pdf-tab"
        document={document}
        locale="zh-CN"
        dark={false}
        initialPage={2}
        initialScale={1}
        initialRotation={0}
        searchOpen={false}
        searchQuery=""
        searchIndex={0}
        onReadingChange={vi.fn()}
        onSearchCountChange={vi.fn()}
        onSearchPendingChange={vi.fn()}
      />)
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    const scrollSpy = vi.mocked(Element.prototype.scrollIntoView)
    const restoredPage = host.querySelector('[data-page-number="2"]')
    const restoreCallIndex = scrollSpy.mock.contexts.indexOf(restoredPage)
    expect(restoreCallIndex).toBeGreaterThanOrEqual(0)
    expect(scrollSpy.mock.calls[restoreCallIndex]).toEqual([{ block: 'start', behavior: 'auto' }])
  })
})
