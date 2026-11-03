import { describe, expect, it } from 'vitest'
import { capabilitiesForType, documentTypeFromPath } from './types'

describe('文档能力映射', () => {
  it('按文档类型提供统一入口能使用的能力', () => {
    expect(capabilitiesForType('markdown')).toEqual(['read', 'search', 'toc', 'math', 'mermaid', 'print'])
    expect(capabilitiesForType('pdf')).toEqual(['read', 'search', 'thumbnails', 'page-navigation', 'page-zoom'])
    expect(capabilitiesForType('ofd')).toEqual(['read', 'search', 'thumbnails', 'page-navigation', 'page-zoom'])
  })

  it('按扩展名识别三种只读格式，不把其他格式路由到 reader', () => {
    expect(documentTypeFromPath('/docs/a.markdown')).toBe('markdown')
    expect(documentTypeFromPath('/docs/a.PDF')).toBe('pdf')
    expect(documentTypeFromPath('/docs/a.ofd')).toBe('ofd')
    expect(documentTypeFromPath('/docs/a.docx')).toBeNull()
  })
})
