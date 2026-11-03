import { invoke } from '@tauri-apps/api/core'
import type { DocumentAdapter, DocumentDescriptor } from '../core/types'
import { capabilitiesForType } from '../core/types'

export type OfdReaderDocument = {
  documentType: 'ofd'
  filePath: string
  fileName: string
  byteSize: number
  modifiedUnixMicros: number
  pageCount: number
  hasSignatures: boolean
  resourceWarnings: string[]
  fontResources: OfdFontResource[]
  bytes: Uint8Array
}

export type OfdFontResource = {
  id: string
  fontName: string
  familyName?: string
  charset: string
  serif: boolean
  bold: boolean
  italic: boolean
  fixedSize: boolean
  requiredCharacters: string
}

type OfdDocumentInfo = {
  canonicalPath: string
  displayName: string
  byteSize: number
  modifiedUnixMicros: number
  pageCount: number
  hasSignatures: boolean
  resourceWarnings: string[]
  fontResources: OfdFontResource[]
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function describeOfdLoadError(reason: unknown): string {
  const message = errorText(reason)
  if (/加密|encrypted/i.test(message)) return '此 OFD 文件包含加密内容，MdStudio 暂不支持加密 OFD。'
  if (/128 MiB|安全限制|压缩比|条目/i.test(message)) return '此 OFD 文件超过本地阅读安全限制。'
  if (/OFD\.xml|manifest|入口/i.test(message)) return '无法打开此 OFD：容器缺少有效的 OFD.xml 或文档入口。'
  if (/ZIP|容器|损坏|XML|路径引用|不安全路径/i.test(message)) return `无法打开此 OFD：文件容器损坏或结构不受支持。${message}`
  if (/取消|cancelled|canceled|aborted/i.test(message)) return 'OFD 打开已取消。'
  return `无法打开 OFD：${message}`
}

/** 创建仅读取本地 OFD 二进制数据的适配器。 */
export function createOfdAdapter(): DocumentAdapter<OfdReaderDocument> {
  return {
    documentType: 'ofd',
    extensions: ['ofd'],
    capabilities: capabilitiesForType('ofd'),
    async open(filePath, options) {
      if (options?.signal?.aborted) throw new Error('OFD 打开已取消。')
      let info: OfdDocumentInfo
      try {
        info = await invoke<OfdDocumentInfo>('inspect_ofd_document', { filePath })
      } catch (reason) {
        throw new Error(describeOfdLoadError(reason))
      }
      if (options?.signal?.aborted) throw new Error('OFD 打开已取消。')
      const requestId = crypto.randomUUID()
      const cancelRead = () => { void invoke('cancel_ofd_read', { requestId }).catch(() => undefined) }
      options?.signal?.addEventListener('abort', cancelRead, { once: true })
      let buffer: ArrayBuffer
      try {
        buffer = await invoke<ArrayBuffer>('read_ofd_document', {
          filePath: info.canonicalPath,
          expectedByteSize: info.byteSize,
          expectedModifiedUnixMicros: info.modifiedUnixMicros,
          requestId,
        })
      } catch (reason) {
        throw new Error(describeOfdLoadError(reason))
      } finally {
        options?.signal?.removeEventListener('abort', cancelRead)
      }
      if (options?.signal?.aborted) {
        new Uint8Array(buffer).fill(0)
        throw new Error('OFD 打开已取消。')
      }

      const bytes = new Uint8Array(buffer)
      let closed = false
      const descriptor: DocumentDescriptor = {
        documentType: 'ofd',
        canonicalPath: info.canonicalPath,
        displayName: info.displayName,
      }
      const payload: OfdReaderDocument = {
        documentType: 'ofd',
        filePath: info.canonicalPath,
        fileName: info.displayName,
        byteSize: info.byteSize,
        modifiedUnixMicros: info.modifiedUnixMicros,
        pageCount: info.pageCount,
        hasSignatures: info.hasSignatures,
        resourceWarnings: info.resourceWarnings,
        fontResources: info.fontResources ?? [],
        bytes,
      }
      return {
        descriptor,
        capabilities: this.capabilities,
        payload,
        async close() {
          if (closed) return
          closed = true
          bytes.fill(0)
        },
      }
    },
  }
}
