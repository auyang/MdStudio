export type DocumentType = 'markdown' | 'pdf' | 'ofd'

export type DocumentCapability =
  | 'read'
  | 'search'
  | 'toc'
  | 'outline'
  | 'thumbnails'
  | 'page-navigation'
  | 'page-zoom'
  | 'math'
  | 'mermaid'
  | 'print'

export function capabilitiesForType(documentType: DocumentType): readonly DocumentCapability[] {
  if (documentType === 'markdown') return ['read', 'search', 'toc', 'math', 'mermaid', 'print']
  return ['read', 'search', 'thumbnails', 'page-navigation', 'page-zoom']
}

export type DocumentDescriptor = {
  documentType: DocumentType
  canonicalPath: string
  displayName: string
}

export type MarkdownPosition = {
  kind: 'markdown'
  path: string
  headingId?: string
  scrollTop: number
  scrollRatio: number
}

export type PagedPosition = {
  kind: 'paged'
  path: string
  page: number
  scale: number
  offsetX: number
  offsetY: number
}

export type DocumentPosition = MarkdownPosition | PagedPosition

export function documentTypeFromPath(path: string): DocumentType | null {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  const extension = name.slice(dot + 1).toLowerCase()
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  if (extension === 'pdf') return 'pdf'
  if (extension === 'ofd') return 'ofd'
  return null
}

export type DocumentSession<TPayload> = {
  descriptor: DocumentDescriptor
  capabilities: readonly DocumentCapability[]
  payload: TPayload
  close(): Promise<void>
}

export type DocumentAdapter<TPayload> = {
  documentType: DocumentType
  extensions: readonly string[]
  capabilities: readonly DocumentCapability[]
  open(canonicalPath: string, options?: { signal?: AbortSignal }): Promise<DocumentSession<TPayload>>
}
