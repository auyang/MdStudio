import katex from 'katex'
import 'katex/dist/katex.min.css'

interface MathRendererProps {
  source: string
  display?: boolean
}

export function MathRenderer({ source, display = false }: MathRendererProps) {
  try {
    const html = katex.renderToString(source, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: 'warn',
    })
    return <span className={display ? 'math-rendered math-display' : 'math-rendered'} dangerouslySetInnerHTML={{ __html: html }} />
  } catch (error) {
    const message = error instanceof Error ? error.message : '公式语法无法解析'
    return (
      <span className={`math-error${display ? ' math-display' : ''}`} role="alert">
        <span>公式错误：{message}</span>
        <code>{source}</code>
      </span>
    )
  }
}
