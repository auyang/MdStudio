import { describe, expect, it, vi } from 'vitest'
import { createMarkdownAdapter, DocumentAdapterRegistry } from './registry'

type Payload = { filePath: string; fileName: string }

describe('文档类型适配器注册表', () => {
  it('仅启用已注册的 Markdown 阅读器，同时识别 PDF/OFD 为未启用格式', async () => {
    const load = vi.fn(async (filePath: string): Promise<Payload> => ({ filePath, fileName: '文档.md' }))
    const release = vi.fn(async () => undefined)
    const registry = new DocumentAdapterRegistry<Payload>()
    registry.register(createMarkdownAdapter({ load, release }))

    expect(registry.typeForPath('/tmp/文档.MARKDOWN')).toBe('markdown')
    expect(registry.typeForPath('/tmp/文档.pdf')).toBeNull()
    expect(registry.knownTypeForPath('/tmp/文档.pdf')).toBe('pdf')
    expect(registry.knownTypeForPath('/tmp/文档.OFD')).toBe('ofd')
    await expect(registry.open('/tmp/文档.pdf')).rejects.toThrow('PDF 格式已识别')
    await expect(registry.open('/tmp/文档.ofd')).rejects.toThrow('OFD 格式已识别')
    expect(load).not.toHaveBeenCalled()

    const session = await registry.open('/tmp/文档.md')
    expect(session.descriptor).toMatchObject({ documentType: 'markdown', canonicalPath: '/tmp/文档.md' })
    expect(session.capabilities).toEqual(['read', 'search', 'toc', 'math', 'mermaid', 'print'])
    await session.close()
    await session.close()
    expect(release).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('拒绝重复的文档类型和扩展名注册', () => {
    const registry = new DocumentAdapterRegistry<Payload>()
    const adapter = createMarkdownAdapter<Payload>({ load: async filePath => ({ filePath, fileName: 'a.md' }), release: async () => undefined })
    registry.register(adapter)
    expect(() => registry.register(adapter)).toThrow('已注册 markdown')
    expect(() => registry.register({ ...adapter, documentType: 'pdf' })).toThrow('扩展名 .md 已映射')
  })
})
