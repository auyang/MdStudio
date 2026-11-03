// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPdfAdapter, describePdfLoadError } from './reader'

const tauriMock = vi.hoisted(() => ({ invoke: vi.fn() }))
const pdfjsMock = vi.hoisted(() => ({ getDocument: vi.fn(), transport: null as unknown }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMock.invoke }))
vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'local-pdf-worker.mjs' }))
vi.mock('pdfjs-dist', () => {
  class PDFDataRangeTransport {
    readonly onDataRange = vi.fn()
    constructor(readonly length: number, readonly initialData: Uint8Array | null, readonly progressiveDone: boolean, readonly fileName: string) {
      pdfjsMock.transport = this
    }
  }
  return { GlobalWorkerOptions: { workerSrc: '' }, PDFDataRangeTransport, getDocument: pdfjsMock.getDocument }
})

const pdfInfo = {
  canonicalPath: '/tmp/local.pdf',
  displayName: 'local.pdf',
  byteSize: 100,
  modifiedUnixMicros: 1700000000000000,
}

describe('PDF 本地文档适配器', () => {
  beforeEach(() => {
    tauriMock.invoke.mockReset()
    pdfjsMock.getDocument.mockReset()
    pdfjsMock.transport = null
    tauriMock.invoke.mockImplementation(async (command: string) => {
      if (command === 'inspect_pdf_document') return pdfInfo
      if (command === 'read_pdf_range') return Uint8Array.from([1, 2, 3, 4]).buffer
      return undefined
    })
    const pdfDocument = { numPages: 2, getOutline: vi.fn(async () => []) }
    pdfjsMock.getDocument.mockReturnValue({ promise: Promise.resolve(pdfDocument), destroy: vi.fn(async () => undefined) })
  })

  it('通过受控 IPC 提供 PDF 区间数据，并在标签关闭时销毁加载任务', async () => {
    const session = await createPdfAdapter().open('/tmp/local.pdf')
    expect(session.descriptor).toMatchObject({ documentType: 'pdf', canonicalPath: '/tmp/local.pdf', displayName: 'local.pdf' })
    expect(session.payload.pageCount).toBe(2)
    expect(session.capabilities).toEqual(['read', 'search', 'thumbnails', 'page-navigation', 'page-zoom'])
    const options = pdfjsMock.getDocument.mock.calls[0][0]
    expect(options.rangeChunkSize).toBe(64 * 1024)
    expect(options.disableAutoFetch).toBe(true)
    expect(options.disableStream).toBe(true)
    expect(options.cMapUrl).toContain('/pdfjs/cmaps/')
    expect(options.standardFontDataUrl).toContain('/pdfjs/standard_fonts/')

    options.range.requestDataRange(16, 20)
    await vi.waitFor(() => expect(tauriMock.invoke).toHaveBeenCalledWith('read_pdf_range', expect.objectContaining({
      filePath: '/tmp/local.pdf', expectedByteSize: 100, begin: 16, end: 20,
    })))
    await vi.waitFor(() => expect((pdfjsMock.transport as { onDataRange: ReturnType<typeof vi.fn> }).onDataRange).toHaveBeenCalledWith(16, expect.any(Uint8Array)))
    options.range.requestDataRange(24, 28)
    const closing = session.close()
    await vi.waitFor(() => expect(tauriMock.invoke).toHaveBeenCalledWith('cancel_pdf_range', expect.objectContaining({ requestId: expect.any(String) })))
    await closing
    await session.close()
    expect(pdfjsMock.getDocument.mock.results[0].value.destroy).toHaveBeenCalledTimes(1)
  })

  it('不会启动已经取消的打开请求，并为加密和损坏 PDF 显示可读原因', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(createPdfAdapter().open('/tmp/local.pdf', { signal: controller.signal })).rejects.toThrow('PDF 打开已取消')
    expect(tauriMock.invoke).not.toHaveBeenCalled()
    expect(describePdfLoadError(new Error('PasswordException: No password given'))).toContain('密码保护')
    expect(describePdfLoadError(new Error('InvalidPDFException: Invalid PDF structure'))).toContain('格式无效')
  })

  it('文件在范围读取期间改变时保留 Rust 返回的具体原因', async () => {
    tauriMock.invoke.mockImplementation(async (command: string) => {
      if (command === 'inspect_pdf_document') return pdfInfo
      if (command === 'read_pdf_range') throw new Error('PDF 文件在读取期间已发生变化，请重新打开')
      return undefined
    })
    pdfjsMock.getDocument.mockImplementation((options: { range: { requestDataRange: (begin: number, end: number) => void } }) => {
      options.range.requestDataRange(0, 32)
      return {
        promise: new Promise((_, reject) => setTimeout(() => reject(new Error('UnknownErrorException: range read failed')), 10)),
        destroy: vi.fn(async () => undefined),
      }
    })
    await expect(createPdfAdapter().open('/tmp/local.pdf')).rejects.toThrow('PDF 文件在读取期间发生了变化，请重新打开文件。')
  })
})
