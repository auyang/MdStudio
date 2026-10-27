// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  drawSearchFallback,
  findDocumentTextMatches,
} from './documentSearch'

const searchFixture = (name: string) => readFileSync(resolve(process.cwd(), `docs/tasks/reader-p1-7/tests/fixtures/search/${name}`), 'utf8')

function article(html: string): HTMLElement {
  const element = document.createElement('article')
  element.innerHTML = html
  return element
}

describe('当前文档的 Range 搜索', () => {
  it('支持中文、中英文混合、英文不区分大小写及重复命中', () => {
    const fixture = searchFixture('chinese-and-inline.md')
    expect(fixture).toContain('阅读体验')
    expect(fixture).toContain('MdStudio、mdstudio、MDSTUDIO')
    const root = article('<p>阅读体验 MdStudio、mdstudio、MDSTUDIO 阅读体验</p>')

    expect(findDocumentTextMatches(root, '阅读体验')).toHaveLength(2)
    expect(findDocumentTextMatches(root, 'mdstudio')).toHaveLength(3)
    expect(findDocumentTextMatches(root, 'MdStudio', true)).toHaveLength(1)
  })

  it('跨越同一段落内的粗体与代码节点，不跨越段落边界', () => {
    const fixture = searchFixture('chinese-and-inline.md')
    expect(fixture).toContain('你好**世界**')
    const root = article('<p>你好<strong>世界</strong>；你好<code>世界</code></p><p>你好</p><p>世界</p>')

    expect(findDocumentTextMatches(root, '你好世界')).toHaveLength(2)
    expect(findDocumentTextMatches(root, '你好世界!')).toHaveLength(0)
  })

  it('覆盖表格、引用、列表、标题及带语法高亮 span 的代码块', () => {
    const fixture = searchFixture('table-code.md')
    expect(fixture).toContain('```typescript')
    const root = article([
      '<h2>搜索标题</h2>',
      '<table><tbody><tr><td><span>搜索</span></td><td>搜索结果</td></tr></tbody></table>',
      '<blockquote><p>搜索引用</p></blockquote>',
      '<ul><li><p>搜索列表</p></li></ul>',
      '<pre><code><span>search</span><span>Term</span>();</code><button>复制</button></pre>',
    ].join(''))

    expect(findDocumentTextMatches(root, '搜索')).toHaveLength(5)
    expect(findDocumentTextMatches(root, 'searchTerm')).toHaveLength(1)
  })

  it('不搜索 Mermaid SVG、缺失资源提示和复制按钮，也不改变正文 DOM', () => {
    const fixture = searchFixture('mermaid-scope.md')
    expect(fixture).toContain('```mermaid')
    const root = article('<p>可搜索正文</p><div class="reader-mermaid-host"><svg><text>会议开始</text></svg></div><div class="reader-missing-image">缺失图片提示</div><pre><code>可搜索代码</code><button>可搜索代码</button></pre>')
    const beforeHTML = root.innerHTML
    const beforeNodes = Array.from(root.querySelectorAll('*'))
    const beforeTextNodes: Node[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) beforeTextNodes.push(walker.currentNode)

    expect(findDocumentTextMatches(root, '会议开始')).toHaveLength(0)
    expect(findDocumentTextMatches(root, '可搜索代码')).toHaveLength(1)
    expect(root.innerHTML).toBe(beforeHTML)
    expect(Array.from(root.querySelectorAll('*'))).toEqual(beforeNodes)
    const afterTextNodes: Node[] = []
    const afterWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (afterWalker.nextNode()) afterTextNodes.push(afterWalker.currentNode)
    expect(afterTextNodes).toEqual(beforeTextNodes)
  })

  it('在 1 MiB 文本上计数大量重复匹配，不限制真实总数', () => {
    const fixture = searchFixture('long-repeats.md')
    const largeText = (fixture + ' MdStudio').repeat(2)
    const root = article('')
    const paragraph = document.createElement('p')
    paragraph.textContent = largeText
    root.append(paragraph)
    expect(new TextEncoder().encode(largeText).byteLength).toBeGreaterThan(1_000_000)

    const matches = findDocumentTextMatches(root, 'MdStudio')
    expect(matches.length).toBe(largeText.split('MdStudio').length - 1)
  })

  it('旧 WebView 的 Canvas 回退只绘制可见范围并保留原文节点', () => {
    const root = article('<p>可见内容</p>')
    const before = root.innerHTML
    const match = findDocumentTextMatches(root, '可见')[0]
    const range = match.ranges[0]
    Object.defineProperty(range, 'getClientRects', { value: () => [{ left: 10, top: 20, right: 40, bottom: 36, width: 30, height: 16 }] })
    const fillRect = vi.fn()
    const strokeRect = vi.fn()
    const context = { setTransform: vi.fn(), clearRect: vi.fn(), fillRect, strokeRect, fillStyle: '', strokeStyle: '', lineWidth: 1 }
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'getContext', { value: () => context })

    drawSearchFallback(canvas, [match], 0, { width: 100, height: 100, top: 10, bottom: 80, pixelRatio: 2 })
    expect(canvas.width).toBe(200)
    expect(fillRect).toHaveBeenCalledWith(10, 20, 30, 16)
    expect(strokeRect).toHaveBeenCalledWith(10, 20, 30, 16)
    expect(root.innerHTML).toBe(before)
  })
})
