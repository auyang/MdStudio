// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { renderReaderMath } from './mathRendering'
import type { AppLocale } from '../../features/reader/preferences'

let host: HTMLDivElement | undefined

function createHost(html: string) {
  host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

afterEach(() => {
  host?.remove()
  host = undefined
})

describe('KaTeX 阅读渲染', () => {
  it('渲染行内、块级与 LaTeX 分隔符公式，并保留可复制原文', async () => {
    const root = createHost([
      '<p>中文 <span data-math-style="inline">E=mc^2</span> 混排。</p>',
      '<p><span data-math-style="inline">a^2+b^2=c^2</span></p>',
      '<span data-math-style="display">\\begin{aligned}x&amp;=\\frac{1}{2}\\\\y&amp;=\\sum_{k=1}^{n}k^2\\end{aligned}</span>',
      '<span data-math-style="display">\\begin{bmatrix}a&amp;b\\\\c&amp;d\\end{bmatrix}</span>',
    ].join(''))

    await renderReaderMath(root, () => 'zh-CN' as AppLocale, () => false)

    const formulas = root.querySelectorAll('.reader-math')
    expect(formulas).toHaveLength(4)
    expect(root.querySelectorAll('.katex')).toHaveLength(4)
    expect(root.querySelectorAll('.reader-math-copy')).toHaveLength(4)
    expect(root.querySelector('.reader-math-wrap-inline')?.querySelector('[data-reader-math-source="E=mc^2"]')).not.toBeNull()
    expect(root.querySelector('.reader-math-wrap-display .katex-display')).not.toBeNull()
  })

  it('公式错误时保留源码并显示错误提示和复制入口', async () => {
    const root = createHost('<span data-math-style="display">\\notARealCommand{x}</span>')

    await renderReaderMath(root, () => 'zh-CN' as AppLocale, () => false)

    expect(root.querySelector('.reader-math-error')?.textContent).toContain('\\notARealCommand{x}')
    expect(root.querySelector('.reader-math-error-label')?.textContent).toContain('公式语法无法解析')
    expect(root.querySelector<HTMLButtonElement>('[data-copy-math]')?.dataset.readerMathSource).toBe('\\notARealCommand{x}')
  })

  it('没有公式节点时不注入 KaTeX 内容', async () => {
    const root = createHost('<p>价格 $99，代码 <code>$x^2$</code></p>')
    const before = root.innerHTML

    await renderReaderMath(root, () => 'zh-CN' as AppLocale, () => false)

    expect(root.innerHTML).toBe(before)
    expect(root.querySelector('.katex')).toBeNull()
  })

  it('逐个渲染大量公式且不因单个错误中断其余节点', async () => {
    const formulas = Array.from({ length: 240 }, (_, index) =>
      `<span data-math-style="display">x_{${index + 1}}=\\frac{${index + 1}}{${index + 2}}</span>`,
    )
    formulas.splice(120, 0, '<span data-math-style="display">\\notARealCommand{x}</span>')
    const root = createHost(formulas.join(''))

    await renderReaderMath(root, () => 'zh-CN' as AppLocale, () => false)

    expect(root.querySelectorAll('.reader-math-wrap')).toHaveLength(241)
    expect(root.querySelectorAll('.reader-math-error')).toHaveLength(1)
    expect(root.querySelectorAll('.katex')).toHaveLength(240)
  })
})
