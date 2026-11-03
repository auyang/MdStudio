import { capabilitiesForType, documentTypeFromPath } from './types'
import type { DocumentAdapter, DocumentType } from './types'

export class DocumentAdapterRegistry<TPayload> {
  private readonly adapters = new Map<DocumentType, DocumentAdapter<TPayload>>()
  private readonly extensions = new Map<string, DocumentType>()

  register<TDocument extends TPayload>(adapter: DocumentAdapter<TDocument>): void {
    if (this.adapters.has(adapter.documentType)) {
      throw new Error(`已注册 ${adapter.documentType} 文档适配器。`)
    }
    const normalizedExtensions = adapter.extensions.map(extension => extension.replace(/^\./, '').toLowerCase())
    for (const normalized of normalizedExtensions) {
      const existing = this.extensions.get(normalized)
      if (existing) throw new Error(`文件扩展名 .${normalized} 已映射到 ${existing}。`)
    }
    for (const normalized of normalizedExtensions) this.extensions.set(normalized, adapter.documentType)
    this.adapters.set(adapter.documentType, adapter as unknown as DocumentAdapter<TPayload>)
  }

  typeForPath(path: string): DocumentType | null {
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
    const dot = name.lastIndexOf('.')
    if (dot <= 0 || dot === name.length - 1) return null
    return this.extensions.get(name.slice(dot + 1).toLowerCase()) ?? null
  }

  knownTypeForPath(path: string): DocumentType | null {
    return documentTypeFromPath(path)
  }

  async open(path: string, options?: { signal?: AbortSignal }) {
    const documentType = this.knownTypeForPath(path)
    if (!documentType) throw new Error('不支持此文件格式。')
    const adapter = this.adapters.get(documentType)
    if (!adapter) throw new Error(`${documentType.toUpperCase()} 格式已识别，但当前版本未启用阅读器。`)
    return adapter.open(path, options)
  }
}

export function createMarkdownAdapter<TPayload extends {
  filePath: string
  fileName: string
}>({
  load,
  release,
}: {
  load(path: string): Promise<TPayload>
  release(payload: TPayload): Promise<unknown>
}): DocumentAdapter<TPayload> {
  return {
    documentType: 'markdown',
    extensions: ['md', 'markdown'],
    capabilities: capabilitiesForType('markdown'),
    async open(canonicalPath) {
      const payload = await load(canonicalPath)
      let closeRequest: Promise<void> | undefined
      return {
        descriptor: {
          documentType: 'markdown',
          canonicalPath: payload.filePath || canonicalPath,
          displayName: payload.fileName,
        },
        capabilities: this.capabilities,
        payload,
        close() {
          closeRequest ??= Promise.resolve().then(() => release(payload)).then(() => undefined)
          return closeRequest
        },
      }
    },
  }
}
