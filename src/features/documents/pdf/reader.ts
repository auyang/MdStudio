import { invoke } from '@tauri-apps/api/core'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { DocumentAdapter, DocumentDescriptor, DocumentSession } from '../core/types'
import type { DocumentCapability } from '../core/types'
import { capabilitiesForType } from '../core/types'

export type PdfOutlineItem = {
  title: string
  dest: string | unknown[] | null
  items: PdfOutlineItem[]
}

export type PdfReaderDocument = {
  documentType: 'pdf'
  filePath: string
  fileName: string
  byteSize: number
  modifiedUnixMicros: number
  pageCount: number
  pdfDocument: PDFDocumentProxy
  outline: PdfOutlineItem[]
}

type PdfDocumentInfo = {
  canonicalPath: string
  displayName: string
  byteSize: number
  modifiedUnixMicros: number
}

type PdfJsModule = typeof import('pdfjs-dist')
let pdfJsPromise: Promise<PdfJsModule> | undefined

async function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsPromise ??= import('pdfjs-dist').then(pdfjs => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    return pdfjs
  })
  return pdfJsPromise
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function describePdfLoadError(reason: unknown): string {
  const message = errorText(reason)
  if (/PasswordException|password|encrypted/i.test(message)) return '此 PDF 受密码保护，MdStudio 暂不支持输入密码。'
  if (/InvalidPDFException|Invalid PDF|Invalid PDF structure|Missing PDF/i.test(message)) return '无法读取此 PDF 文件：文件已损坏或格式无效。'
  if (/文件在读取期间已发生变化|PDF 文件已变化|请重新打开/i.test(message)) return 'PDF 文件在读取期间发生了变化，请重新打开文件。'
  if (/被取消|cancelled|canceled|aborted|Loading aborted/i.test(message)) return 'PDF 打开已取消。'
  return `无法打开 PDF：${message}`
}

function createLocalPdfRangeTransport(info: PdfDocumentInfo, pdfjs: PdfJsModule) {
  const BaseTransport = pdfjs.PDFDataRangeTransport
  return new class extends BaseTransport {
    private disposed = false
    private readonly pending = new Map<string, Promise<void>>()
    errorMessage: string | undefined

    constructor() {
      super(info.byteSize, null, false, info.displayName)
    }

    requestDataRange(begin: number, end: number): void {
      if (this.disposed || !Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || end <= begin) return
      const requestId = crypto.randomUUID()
      const request = invoke<ArrayBuffer>('read_pdf_range', {
        filePath: info.canonicalPath,
        expectedByteSize: info.byteSize,
        expectedModifiedUnixMicros: info.modifiedUnixMicros,
        begin,
        end,
        requestId,
      }).then(buffer => {
        if (!this.disposed) this.onDataRange(begin, new Uint8Array(buffer))
      }).catch(reason => {
        this.errorMessage ??= errorText(reason)
        if (!this.disposed) this.onDataRange(begin, null)
      }).finally(() => this.pending.delete(requestId))
      this.pending.set(requestId, request)
    }

    abort(): void {
      if (this.disposed) return
      this.disposed = true
      for (const requestId of this.pending.keys()) {
        void invoke('cancel_pdf_range', { requestId }).catch(() => undefined)
      }
      this.pending.clear()
    }
  }()
}

/** Creates an adapter whose binary ranges remain on the local Rust IPC boundary. */
export function createPdfAdapter(): DocumentAdapter<PdfReaderDocument> {
  return {
    documentType: 'pdf',
    extensions: ['pdf'],
    capabilities: capabilitiesForType('pdf'),
    async open(filePath, options) {
      if (options?.signal?.aborted) throw new Error('PDF 打开已取消。')
      const info = await invoke<PdfDocumentInfo>('inspect_pdf_document', { filePath })
      if (options?.signal?.aborted) throw new Error('PDF 打开已取消。')

      const pdfjs = await loadPdfJs()
      const transport = createLocalPdfRangeTransport(info, pdfjs)
      const resourceRoot = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href)
      const loadingTask = pdfjs.getDocument({
        range: transport,
        rangeChunkSize: 64 * 1024,
        disableStream: true,
        disableAutoFetch: true,
        stopAtErrors: true,
        cMapUrl: new URL('cmaps/', resourceRoot).toString(),
        cMapPacked: true,
        standardFontDataUrl: new URL('standard_fonts/', resourceRoot).toString(),
        wasmUrl: new URL('wasm/', resourceRoot).toString(),
        iccUrl: new URL('iccs/', resourceRoot).toString(),
        useWorkerFetch: true,
      })

      let closeRequest: Promise<void> | undefined
      const close = () => {
        closeRequest ??= (async () => {
          transport.abort()
          options?.signal?.removeEventListener('abort', cancelLoading)
          await loadingTask.destroy()
        })()
        return closeRequest
      }
      const cancelLoading = () => { void close().catch(() => undefined) }
      options?.signal?.addEventListener('abort', cancelLoading, { once: true })

      let pdfDocument: PDFDocumentProxy
      try {
        pdfDocument = await loadingTask.promise
      } catch (reason) {
        transport.abort()
        options?.signal?.removeEventListener('abort', cancelLoading)
        await loadingTask.destroy().catch(() => undefined)
        throw new Error(describePdfLoadError(transport.errorMessage ?? reason))
      }

      if (options?.signal?.aborted) {
        await close()
        throw new Error('PDF 打开已取消。')
      }

      let outline: PdfOutlineItem[] = []
      try { outline = (await pdfDocument.getOutline() as PdfOutlineItem[] | null) ?? [] } catch { /* 目录损坏不应阻止正文阅读。 */ }

      const descriptor: DocumentDescriptor = {
        documentType: 'pdf',
        canonicalPath: info.canonicalPath,
        displayName: info.displayName,
      }
      const payload: PdfReaderDocument = {
        documentType: 'pdf',
        filePath: info.canonicalPath,
        fileName: info.displayName,
        byteSize: info.byteSize,
        modifiedUnixMicros: info.modifiedUnixMicros,
        pageCount: pdfDocument.numPages,
        pdfDocument,
        outline,
      }
      const capabilities: readonly DocumentCapability[] = outline.length
        ? [...this.capabilities, 'outline']
        : this.capabilities
      return {
        descriptor,
        capabilities,
        payload,
        close,
      } satisfies DocumentSession<PdfReaderDocument>
    },
  }
}
