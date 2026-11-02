import type { AppLocale } from '../../features/reader/preferences'
import { translate } from '../../features/i18n'

type KatexModule = typeof import('katex')

let katexModule: Promise<KatexModule> | null = null

function loadKatex(): Promise<KatexModule> {
  if (!katexModule) {
    katexModule = Promise.all([
      import('katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([module]) => module).catch((error: unknown) => {
      katexModule = null
      throw error
    })
  }
  return katexModule
}

function markFormulaError(element: HTMLElement, locale: AppLocale, message: string) {
  element.dataset.readerMathRendered = 'error'
  element.classList.add('reader-math-error')
  const label = element.ownerDocument.createElement('span')
  label.className = 'reader-math-error-label'
  label.dataset.readerI18n = 'math-error'
  label.dataset.readerMathErrorMessage = message
  label.setAttribute('role', 'note')
  label.textContent = translate(locale, message)
  element.append(label)
}

function wrapFormula(element: HTMLElement, source: string, displayMode: boolean, codeBlock: boolean, locale: AppLocale) {
  const document = element.ownerDocument
  const wrapper = document.createElement(displayMode || codeBlock ? 'div' : 'span')
  wrapper.className = `reader-math-wrap ${displayMode || codeBlock ? 'reader-math-wrap-display' : 'reader-math-wrap-inline'}`
  wrapper.dataset.readerMathSource = source

  const target = codeBlock ? element.parentElement?.parentElement : element
  if (target?.parentElement) {
    target.replaceWith(wrapper)
    wrapper.append(target)
  } else {
    wrapper.append(element)
  }

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'reader-math-copy'
  copy.dataset.copyMath = 'true'
  copy.dataset.readerMathSource = source
  copy.dataset.readerI18n = 'copy-math'
  copy.textContent = '⧉'
  copy.setAttribute('aria-label', translate(locale, '复制 LaTeX 公式'))
  copy.setAttribute('title', translate(locale, '复制 LaTeX 公式'))
  wrapper.append(copy)
}

/** 只处理 Comrak 标记出的数学节点；普通文档不会加载 KaTeX。 */
export async function renderReaderMath(
  root: ParentNode,
  getLocale: () => AppLocale,
  isCancelled: () => boolean,
): Promise<void> {
  const formulas = Array.from(root.querySelectorAll<HTMLElement>(
    'span[data-math-style], code[data-math-style], pre[data-math-style] > code',
  )).filter(element => {
    element.dataset.mathStyle ||= element.parentElement?.dataset.mathStyle ?? ''
    return (element.dataset.mathStyle === 'inline' || element.dataset.mathStyle === 'display')
      && !element.dataset.readerMathRendered
  })
  if (!formulas.length) return
  for (const formula of formulas) formula.dataset.readerMathRendered = 'pending'

  let katex: KatexModule
  try {
    katex = await loadKatex()
  } catch {
    if (isCancelled()) return
    for (const formula of formulas) {
      markFormulaError(formula, getLocale(), '公式资源加载失败，已保留 LaTeX 源码。')
    }
    return
  }

  for (const formula of formulas) {
    if (isCancelled()) return
    const source = formula.textContent ?? ''
    const displayMode = formula.dataset.mathStyle === 'display'
    const codeBlock = formula.tagName === 'CODE' && formula.parentElement?.tagName === 'PRE'

    try {
      const rendered = katex.renderToString(source, {
        displayMode,
        output: 'htmlAndMathml',
        throwOnError: true,
        trust: false,
        strict: 'warn',
        maxExpand: 1000,
        maxSize: 20,
      })
      if (isCancelled()) return
      formula.innerHTML = rendered
      formula.dataset.readerMathRendered = 'true'
      formula.classList.add('reader-math')
      if (codeBlock) formula.parentElement?.classList.add('reader-math-pre')
      wrapFormula(formula, source, displayMode, codeBlock, getLocale())
    } catch {
      if (isCancelled()) return
      if (codeBlock) formula.parentElement?.classList.add('reader-math-pre')
      markFormulaError(formula, getLocale(), '公式语法无法解析，已保留 LaTeX 源码。')
      wrapFormula(formula, source, displayMode, codeBlock, getLocale())
    }
  }
}
