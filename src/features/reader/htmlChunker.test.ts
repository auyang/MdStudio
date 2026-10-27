import { describe, expect, it } from 'vitest'
import { nextHtmlBlockEnd } from './htmlChunker'

describe('分批 HTML 挂载边界', () => {
  it('按完整顶层元素切分并保留嵌套结构和属性中的尖括号', () => {
    const html = '<h1 id="title">标题</h1>\n<table><tbody><tr><td data-value="a > b"><strong>单元格</strong></td></tr></tbody></table><pre><code>x &lt; y</code></pre>'
    const blocks: string[] = []
    let cursor = 0
    while (cursor < html.length) {
      const end = nextHtmlBlockEnd(html, cursor)
      expect(end).toBeGreaterThan(cursor)
      blocks.push(html.slice(cursor, end))
      cursor = end
    }

    expect(blocks).toEqual([
      '<h1 id="title">标题</h1>',
      '\n<table><tbody><tr><td data-value="a > b"><strong>单元格</strong></td></tr></tbody></table>',
      '<pre><code>x &lt; y</code></pre>',
    ])
  })

  it('正确处理自闭合和 HTML void 元素', () => {
    const html = '<hr><p>文字<br>下一行</p><input type="checkbox" disabled>'
    const blocks: string[] = []
    let cursor = 0
    while (cursor < html.length) {
      const end = nextHtmlBlockEnd(html, cursor)
      blocks.push(html.slice(cursor, end))
      cursor = end
    }
    expect(blocks).toEqual(['<hr>', '<p>文字<br>下一行</p>', '<input type="checkbox" disabled>'])
  })

  it('空输入不会循环', () => {
    expect(nextHtmlBlockEnd('', 0)).toBe(0)
  })
})
