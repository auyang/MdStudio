export type DocumentSearchMatch = {
  ranges: Range[]
}

type TextSlice = { node: Text; start: number; end: number }
type SearchBlock = { element: Element; slices: TextSlice[]; text: string }

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DIV', 'DT', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P',
  'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
])
const EXCLUDED_TEXT = 'button,script,style,template,svg,[hidden],[aria-hidden="true"],.reader-mermaid-host,.reader-missing-image,.reader-image-pending,.reader-image-retry'
const SEARCH_HIGHLIGHT_NAME = 'mdstudio-search-match'
const CURRENT_HIGHLIGHT_NAME = 'mdstudio-search-current'

function blockFor(node: Text, root: HTMLElement): Element {
  let element = node.parentElement
  while (element && element !== root) {
    if (BLOCK_TAGS.has(element.tagName)) return element
    element = element.parentElement
  }
  return root
}

function collectBlocks(root: HTMLElement): SearchBlock[] {
  const document = root.ownerDocument
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent
      const parent = node.parentElement
      if (!text || !parent || parent.closest(EXCLUDED_TEXT)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const blocks: SearchBlock[] = []
  let block: SearchBlock | undefined
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const element = blockFor(node, root)
    if (!block || block.element !== element) {
      block = { element, slices: [], text: '' }
      blocks.push(block)
    }
    const start = block.text.length
    block.text += node.data
    block.slices.push({ node, start, end: block.text.length })
  }
  return blocks
}

function normalizeWithOffsets(source: string, caseSensitive: boolean): { text: string; starts: number[] | null; ends: number[] | null } {
  if (caseSensitive) return { text: source, starts: null, ends: null }
  const text = source.toLowerCase()
  let needsOffsetMap = false
  for (let sourceOffset = 0; sourceOffset < source.length;) {
    const codePoint = String.fromCodePoint(source.codePointAt(sourceOffset)!)
    if (codePoint.toLowerCase().length !== codePoint.length) needsOffsetMap = true
    sourceOffset += codePoint.length
  }
  if (!needsOffsetMap) return { text, starts: null, ends: null }

  let normalizedText = ''
  const starts: number[] = []
  const ends: number[] = []
  for (let sourceOffset = 0; sourceOffset < source.length;) {
    const codePoint = String.fromCodePoint(source.codePointAt(sourceOffset)!)
    const normalized = codePoint.toLowerCase()
    normalizedText += normalized
    for (let index = 0; index < normalized.length; index += 1) {
      starts.push(sourceOffset)
      ends.push(sourceOffset + codePoint.length)
    }
    sourceOffset += codePoint.length
  }
  return { text: normalizedText, starts, ends }
}

function rangesForSlice(block: SearchBlock, start: number, end: number, document: Document): Range[] {
  const ranges: Range[] = []
  for (const slice of block.slices) {
    const overlapStart = Math.max(start, slice.start)
    const overlapEnd = Math.min(end, slice.end)
    if (overlapStart >= overlapEnd) continue
    const range = document.createRange()
    range.setStart(slice.node, overlapStart - slice.start)
    range.setEnd(slice.node, overlapEnd - slice.start)
    ranges.push(range)
  }
  return ranges
}

/** 在当前只读正文中搜索可见文本；块边界之间不拼接，行内格式节点之间可以拼接。 */
export function findDocumentTextMatches(root: HTMLElement, query: string, caseSensitive = false): DocumentSearchMatch[] {
  const needle = query.trim()
  if (!needle) return []
  const normalizedNeedle = caseSensitive ? needle : needle.toLowerCase()
  const document = root.ownerDocument
  const matches: DocumentSearchMatch[] = []

  for (const block of collectBlocks(root)) {
    const normalized = normalizeWithOffsets(block.text, caseSensitive)
    let searchFrom = 0
    let foundAt = normalized.text.indexOf(normalizedNeedle, searchFrom)
    while (foundAt >= 0) {
      const sourceStart = normalized.starts ? normalized.starts[foundAt] : foundAt
      const sourceEnd = normalized.ends ? normalized.ends[foundAt + normalizedNeedle.length - 1] : foundAt + normalizedNeedle.length
      const ranges = rangesForSlice(block, sourceStart, sourceEnd, document)
      if (ranges.length) matches.push({ ranges })
      searchFrom = foundAt + normalizedNeedle.length
      foundAt = normalized.text.indexOf(normalizedNeedle, searchFrom)
    }
  }
  return matches
}

type HighlightRegistryLike = { set(name: string, value: object): void; delete(name: string): boolean }
type HighlightLike = { add(range: Range): unknown }
type HighlightConstructor = new () => HighlightLike

function highlightApi(): { registry: HighlightRegistryLike; Highlight: HighlightConstructor } | null {
  const css = (globalThis as typeof globalThis & { CSS?: { highlights?: HighlightRegistryLike } }).CSS
  const Highlight = (globalThis as typeof globalThis & { Highlight?: HighlightConstructor }).Highlight
  return css?.highlights && Highlight ? { registry: css.highlights, Highlight } : null
}

export function supportsCssCustomHighlights(): boolean {
  return highlightApi() !== null
}

function makeHighlight(matches: DocumentSearchMatch[]): object {
  const api = highlightApi()
  if (!api) throw new Error('当前 WebView 不支持 CSS Custom Highlight API')
  const highlight = new api.Highlight()
  for (const match of matches) for (const range of match.ranges) highlight.add(range)
  return highlight
}

/** 返回 false 时由 Canvas 覆盖层提供旧 WebView 的高亮回退。 */
export function applyCssSearchHighlights(matches: DocumentSearchMatch[], currentIndex: number): boolean {
  const api = highlightApi()
  if (!api) return false
  api.registry.delete(SEARCH_HIGHLIGHT_NAME)
  api.registry.delete(CURRENT_HIGHLIGHT_NAME)
  if (!matches.length) return true
  api.registry.set(SEARCH_HIGHLIGHT_NAME, makeHighlight(matches))
  const current = matches[currentIndex]
  if (current) api.registry.set(CURRENT_HIGHLIGHT_NAME, makeHighlight([current]))
  return true
}

export function clearCssSearchHighlights(): void {
  highlightApi()?.registry.delete(SEARCH_HIGHLIGHT_NAME)
  highlightApi()?.registry.delete(CURRENT_HIGHLIGHT_NAME)
}

export type SearchCanvasViewport = { width: number; height: number; top: number; bottom: number; pixelRatio: number }

/** 只绘制当前可见的 Range 矩形；正文 DOM 和文本节点保持原样。 */
export function drawSearchFallback(canvas: HTMLCanvasElement, matches: DocumentSearchMatch[], currentIndex: number, viewport: SearchCanvasViewport, dark = false): void {
  const context = canvas.getContext('2d')
  if (!context) return
  const pixelRatio = Math.max(1, viewport.pixelRatio || 1)
  const width = Math.max(1, Math.round(viewport.width * pixelRatio))
  const height = Math.max(1, Math.round(viewport.height * pixelRatio))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, viewport.width, viewport.height)

  for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    const current = matchIndex === currentIndex
    context.fillStyle = current
      ? (dark ? 'rgba(245, 158, 11, .34)' : 'rgba(245, 158, 11, .28)')
      : (dark ? 'rgba(250, 204, 21, .26)' : 'rgba(250, 204, 21, .22)')
    context.strokeStyle = dark ? 'rgba(251, 191, 36, .95)' : 'rgba(180, 83, 9, .9)'
    context.lineWidth = current ? 1.5 : 0
    for (const range of matches[matchIndex].ranges) {
      if (typeof range.getClientRects !== 'function') continue
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue
        context.fillRect(rect.left, rect.top, rect.width, rect.height)
        if (current) context.strokeRect(rect.left, rect.top, rect.width, rect.height)
      }
    }
  }
}

export function firstRangeRect(match: DocumentSearchMatch | undefined): DOMRect | null {
  const range = match?.ranges[0]
  if (!range || typeof range.getBoundingClientRect !== 'function') return null
  const rect = range.getBoundingClientRect()
  return rect.width || rect.height ? rect : null
}
