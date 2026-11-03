import { useEffect, useId, useState } from 'react'
import mermaid from 'mermaid'

let mermaidQueue = Promise.resolve()

interface MermaidDiagramProps {
  source: string
}

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const id = useId().replace(/:/g, '')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [showSource, setShowSource] = useState(false)

  useEffect(() => {
    let disposed = false
    setSvg('')
    setError('')
    const renderTask = mermaidQueue.then(async () => {
      const styles = getComputedStyle(document.documentElement)
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        theme: 'base',
        themeVariables: {
          primaryColor: styles.getPropertyValue('--accent-pale').trim(),
          primaryTextColor: styles.getPropertyValue('--ink').trim(),
          primaryBorderColor: styles.getPropertyValue('--accent').trim(),
          lineColor: styles.getPropertyValue('--ink-soft').trim(),
          secondaryColor: styles.getPropertyValue('--panel').trim(),
          tertiaryColor: styles.getPropertyValue('--paper').trim(),
          background: styles.getPropertyValue('--paper').trim(),
          mainBkg: styles.getPropertyValue('--panel').trim(),
        },
      })
      await mermaid.parse(source)
      const result = await mermaid.render(`mdstudio-${id}`, source)
      if (!disposed) setSvg(result.svg)
    })
    mermaidQueue = renderTask.catch(() => undefined)
    void renderTask.catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { disposed = true }
  }, [id, source])

  return (
    <section className="mermaid-preview" aria-label="Mermaid 图表预览">
      <div className="advanced-preview-actions">
        <span>Mermaid</span>
        <button type="button" onClick={() => setShowSource((value) => !value)}>{showSource ? '查看图表' : '查看源码'}</button>
      </div>
      {showSource || error ? (
        <div className={error ? 'mermaid-source has-error' : 'mermaid-source'}>
          {error && <p role="alert">Mermaid 语法错误：{error}</p>}
          <pre><code>{source}</code></pre>
        </div>
      ) : svg ? (
        <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="advanced-loading" role="status">正在绘制图表…</div>
      )}
    </section>
  )
}
