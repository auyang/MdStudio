const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

function findTagEnd(html: string, start: number): number {
  let quote = ''
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index + 1
    }
  }
  return html.length
}

/** 返回下一个完整的顶层 HTML 元素结束位置，用于分批挂载已清洗的 Comrak 输出。 */
export function nextHtmlBlockEnd(html: string, start: number): number {
  let depth = 0
  let cursor = start

  while (cursor < html.length) {
    const open = html.indexOf('<', cursor)
    if (open < 0) return html.length

    if (html.startsWith('<!--', open)) {
      const commentEnd = html.indexOf('-->', open + 4)
      cursor = commentEnd < 0 ? html.length : commentEnd + 3
      if (depth === 0) return cursor
      continue
    }

    const end = findTagEnd(html, open)
    if (end <= open + 1 || end > html.length) return html.length
    const tag = html.slice(open + 1, end - 1).trim()
    const closing = tag.startsWith('/')
    const selfClosing = tag.endsWith('/')
    const name = tag.replace(/^\/?\s*/, '').match(/^[a-zA-Z][\w:-]*/)?.[0]?.toLowerCase()
    cursor = end
    if (!name) continue

    if (closing) {
      depth = Math.max(0, depth - 1)
      if (depth === 0) return cursor
    } else if (!selfClosing && !VOID_TAGS.has(name)) {
      depth += 1
    } else if (depth === 0) {
      return cursor
    }
  }

  return html.length
}
