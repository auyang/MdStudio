import DOMPurify from 'dompurify'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MermaidConfig } from 'mermaid'
import { recordPerformance } from '../../features/reader/performance'
import { MediaViewerDialog } from './MediaViewer'
import type { MediaViewerContent } from './MediaViewer'
import { useI18n } from '../../features/i18n'

export { readSvgViewBox } from './MediaViewer'

type Theme = 'light' | 'dark'

interface MermaidDiagramProps {
  source: string
  language: string
  theme: Theme
  documentId?: number
  diagramIndex?: number
}

type SanitizedSvg = { markup: string; changed: boolean; contrastAdjusted: number }

let nextDiagramId = 0
let mermaidQueue: Promise<void> = Promise.resolve()
let mermaidModule: Promise<typeof import('mermaid')> | undefined
let configuredTheme: Theme | undefined

function diagnostic(event: string, details: Record<string, unknown>) {
  if (import.meta.env.DEV) console.info('[MdStudio Mermaid]', { event, ...details })
}

function errorMessage(reason: unknown, source: string): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  return message.replace(source, '[图表源码已省略]').trim() || '未知渲染错误'
}

function explicitFill(element: Element): string | undefined {
  const attribute = element.getAttribute('fill')
  if (attribute && attribute !== 'none') return attribute
  const style = element.getAttribute('style')?.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1]
  const color = style?.replace(/\s*!important\s*$/i, '').trim()
  return color && color !== 'none' ? color : undefined
}

function textColorForFill(fill: string): string | undefined {
  let channels: number[] | undefined
  const hex = fill.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  if (hex) {
    const value = hex.length === 3 ? [...hex].map(channel => channel + channel).join('') : hex
    channels = [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
  } else {
    const rgb = fill.trim().match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)
    if (rgb) channels = rgb.slice(1).map(channel => Number(channel) / 255)
  }
  if (!channels) return undefined
  const [red, green, blue] = channels.map(channel => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
  return luminance > 0.48 ? '#0f172a' : '#f8fafc'
}

export function sanitizeMermaidSvg(svg: string): SanitizedSvg {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'image'],
  })
  const parsed = new DOMParser().parseFromString(clean, 'image/svg+xml')
  const root = parsed.documentElement
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
    throw new Error('SVG 安全过滤后未生成有效的 SVG 根节点。')
  }

  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase()
      const value = attribute.value.trim()
      if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) {
        element.removeAttributeNode(attribute)
        continue
      }
      if (/url\(\s*(['"]?)(?!#)/i.test(value) || /@import/i.test(value)) {
        element.removeAttributeNode(attribute)
      }
    }
  }

  for (const style of Array.from(root.querySelectorAll('style'))) {
    if (/url\(\s*(['"]?)(?!#)|@import/i.test(style.textContent ?? '')) style.remove()
  }
  let contrastAdjusted = 0
  for (const node of Array.from(root.querySelectorAll('g.node'))) {
    const shapes = Array.from(node.querySelectorAll('rect, polygon, ellipse, circle, path'))
    const fill = shapes.map(explicitFill).find(Boolean) ?? explicitFill(node)
    if (!fill) continue
    const textColor = textColorForFill(fill)
    if (!textColor) continue
    for (const text of Array.from(node.querySelectorAll('text'))) {
      text.style.setProperty('fill', textColor, 'important')
      contrastAdjusted += 1
    }
  }
  if (!root.querySelector('g, path, rect, polygon, text')) {
    throw new Error('SVG 安全过滤移除了全部图表内容。')
  }
  return { markup: root.outerHTML, changed: clean !== svg || root.outerHTML !== clean, contrastAdjusted }
}

function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
  const pending = mermaidQueue.then(task)
  mermaidQueue = pending.then(() => undefined, () => undefined)
  return pending
}

function configForTheme(theme: Theme): MermaidConfig {
  const dark = theme === 'dark'
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    theme: 'base',
    themeVariables: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: '14px',
      primaryColor: dark ? '#17243a' : '#eff6ff',
      primaryTextColor: dark ? '#f8fafc' : '#0f172a',
      primaryBorderColor: dark ? '#60a5fa' : '#3b82f6',
      lineColor: dark ? '#94a3b8' : '#64748b',
      secondaryColor: dark ? '#111d30' : '#f8fafc',
      tertiaryColor: dark ? '#0b1220' : '#ffffff',
      background: dark ? '#0b1220' : '#ffffff',
      mainBkg: dark ? '#111d30' : '#ffffff',
      textColor: dark ? '#f8fafc' : '#0f172a',
    },
    flowchart: { useMaxWidth: false },
  }
}

type RenderStage = 'load-module' | 'parse' | 'render' | 'svg-sanitize'

function renderSafeMermaidSvg(
  source: string,
  theme: Theme,
  id: string,
  onStage?: (stage: RenderStage) => void,
  shouldContinue: () => boolean = () => true,
): Promise<SanitizedSvg | null> {
  return enqueueRender(async () => {
    if (!shouldContinue()) return null
    onStage?.('load-module')
    mermaidModule ??= import('mermaid')
    const { default: mermaid } = await mermaidModule
    if (!shouldContinue()) return null

    if (configuredTheme !== theme) {
      mermaid.initialize(configForTheme(theme))
      configuredTheme = theme
    }

    onStage?.('parse')
    let parsed
    try {
      parsed = await mermaid.parse(source)
    } catch (reason) {
      diagnostic('parse-failed', {
        id,
        language: 'mermaid',
        sourceLength: source.length,
        error: errorMessage(reason, source).slice(0, 400),
        stack: reason instanceof Error ? reason.stack?.slice(0, 1000) : undefined,
      })
      throw reason
    }
    if (!shouldContinue()) return null
    diagnostic('parse-succeeded', { id, language: 'mermaid', sourceLength: source.length, parsed: Boolean(parsed) })
    if (!parsed) throw new Error('Mermaid 未能识别该图表语法。')

    onStage?.('render')
    // Mermaid 需要已挂载的容器测量 SVG；使用临时离屏节点，避免改写阅读器 DOM 或影响页面布局。
    const renderHost = document.createElement('div')
    renderHost.className = 'mdstudio-mermaid-measurement-host'
    renderHost.setAttribute('aria-hidden', 'true')
    renderHost.style.cssText = 'position:fixed;left:-100000px;top:0;width:100vw;max-width:none;visibility:hidden;pointer-events:none;overflow:visible;'
    document.body.appendChild(renderHost)
    let result: Awaited<ReturnType<typeof mermaid.render>>
    try {
      result = await mermaid.render(id, source, renderHost)
    } finally {
      renderHost.remove()
    }
    if (!shouldContinue()) return null
    diagnostic('render-succeeded', { id, language: 'mermaid', sourceLength: source.length, svgGenerated: Boolean(result.svg), svgLength: result.svg.length })
    if (!result.svg) throw new Error('Mermaid 没有生成 SVG 图表。')

    onStage?.('svg-sanitize')
    try {
      const safeSvg = sanitizeMermaidSvg(result.svg)
      if (safeSvg.changed) {
        diagnostic('svg-safety-filtered', { id, filtered: true, svgLength: safeSvg.markup.length })
      }
      if (safeSvg.contrastAdjusted) {
        diagnostic('styled-node-contrast-adjusted', { id, nodes: safeSvg.contrastAdjusted })
      }
      return safeSvg
    } catch (reason) {
      diagnostic('svg-safety-filter-error', {
        id,
        error: errorMessage(reason, source).slice(0, 400),
        stack: reason instanceof Error ? reason.stack?.slice(0, 1000) : undefined,
      })
      throw reason
    }
  })
}

export function MermaidDiagram({ source, language, theme, documentId, diagramIndex }: MermaidDiagramProps) {
  const t = useI18n()
  const [instanceId] = useState(() => `mdstudio-mermaid-${++nextDiagramId}`)
  const [attempt, setAttempt] = useState(0)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [showViewer, setShowViewer] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const viewerTriggerRef = useRef<HTMLButtonElement>(null)
  const svgHostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let cspViolation = false
    setSvg('')
    setError('')
    const svgHost = svgHostRef.current
    if (!svgHost) return

    const onSecurityPolicyViolation = (event: SecurityPolicyViolationEvent) => {
      cspViolation = true
      diagnostic('csp-or-security-filter-error', {
        language,
        sourceLength: source.length,
        directive: event.violatedDirective,
        blockedResource: event.blockedURI.split('/').slice(0, 3).join('/'),
      })
      if (!disposed) setError(`内容安全策略阻止了图表资源（${event.violatedDirective}）。`)
    }
    window.addEventListener('securitypolicyviolation', onSecurityPolicyViolation)

    diagnostic('code-block-detected', {
      id: instanceId,
      language,
      sourceLength: source.length,
      attempt: attempt + 1,
    })

    const renderStartedAt = performance.now()
    let stage: RenderStage = 'load-module'
    void renderSafeMermaidSvg(source, theme, `${instanceId}-${attempt + 1}`, nextStage => {
      stage = nextStage
    }, () => !disposed).then(safeSvg => {
      if (disposed || !safeSvg) return
      recordPerformance('mermaid-render-complete', {
        documentId,
        diagramIndex,
        sourceLength: source.length,
        durationMs: Number((performance.now() - renderStartedAt).toFixed(3)),
      })
      setSvg(safeSvg.markup)
    }).catch((reason: unknown) => {
      if (disposed) return
      const message = errorMessage(reason, source)
      recordPerformance('mermaid-render-failed', {
        documentId,
        diagramIndex,
        sourceLength: source.length,
        durationMs: Number((performance.now() - renderStartedAt).toFixed(3)),
      })
      diagnostic('render-failed', {
        id: instanceId,
        language,
        sourceLength: source.length,
        stage: disposed ? 'cancelled' : stage,
        cspViolation,
        error: message.slice(0, 400),
        stack: reason instanceof Error ? reason.stack?.slice(0, 1000) : undefined,
      })
      setError(message)
    })

    return () => {
      disposed = true
      window.removeEventListener('securitypolicyviolation', onSecurityPolicyViolation)
    }
  }, [attempt, documentId, diagramIndex, instanceId, language, source, theme])

  useLayoutEffect(() => {
    if (!svg) return
    const host = svgHostRef.current
    const element = host?.querySelector('svg')
    if (!element) {
      diagnostic('svg-mounted', { id: instanceId, mounted: false, svgGenerated: true })
      setError('渲染结果挂载后没有 SVG 元素。')
      return
    }
    const style = getComputedStyle(element)
    diagnostic('svg-mounted', {
      id: instanceId,
      mounted: true,
      viewBox: element.getAttribute('viewBox'),
      width: element.getAttribute('width'),
      height: element.getAttribute('height'),
      display: style.display,
      visibility: style.visibility,
    })
    recordPerformance('mermaid-svg-mounted', {
      documentId,
      diagramIndex,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    })
    const timer = window.setTimeout(() => {
      if (!element.isConnected) return
      const rect = element.getBoundingClientRect()
      const computed = getComputedStyle(element)
      const visible = computed.display !== 'none' && computed.visibility !== 'hidden'
        && Number(computed.opacity) !== 0 && rect.width > 0 && rect.height > 0
      diagnostic('svg-measurement', {
        id: instanceId,
        mounted: element.isConnected,
        width: rect.width,
        height: rect.height,
        visible,
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [documentId, diagramIndex, instanceId, svg])

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(source)
      setCopyMessage('源码已复制')
    } catch {
      setCopyMessage('无法访问剪贴板，请在源码中手动复制。')
    }
  }

  const renderViewerSvg = useCallback(async (id: string, shouldContinue: () => boolean) => {
    try {
      const result = await renderSafeMermaidSvg(source, theme, id, undefined, shouldContinue)
      return result?.markup ?? null
    } catch (reason) {
      throw new Error(errorMessage(reason, source))
    }
  }, [source, theme])

  const viewerContent: MediaViewerContent = { kind: 'svg', source, render: renderViewerSvg }

  return (
    <section className="reader-mermaid" aria-label={t('Mermaid 流程图')} data-mermaid-source-length={source.length}>
      <div className="reader-mermaid-toolbar">
        <span className="reader-mermaid-label">Mermaid</span>
        <div className="reader-mermaid-actions">
          <button type="button" onClick={() => setShowSource(value => !value)}>
            {t(showSource ? '隐藏源码' : '查看源码')}
          </button>
          <button type="button" onClick={() => void copySource()}>{t('复制源码')}</button>
          {svg && !error && <button type="button" ref={viewerTriggerRef} onClick={() => setShowViewer(true)}>{t('放大查看')}</button>}
          <button type="button" onClick={() => setAttempt(value => value + 1)}>{t('重试渲染')}</button>
        </div>
      </div>
      {error && <div className="reader-mermaid-error" role="alert">
        <strong>{t('Mermaid 流程图渲染失败')}</strong>
        <span>{error.startsWith('内容安全策略阻止了图表资源（') && error.endsWith('）。')
          ? t('内容安全策略阻止了图表资源（{directive}）。', { directive: error.slice('内容安全策略阻止了图表资源（'.length, -2) })
          : t(error)}</span>
      </div>}
      {copyMessage && <div className="reader-mermaid-copy-message" role="status">{t(copyMessage)}</div>}
      {!svg && !error && <div className="reader-mermaid-loading" role="status">{t('正在绘制 Mermaid 图表…')}</div>}
      <div
        className="reader-mermaid-svg"
        ref={svgHostRef}
        aria-hidden={!svg || Boolean(error)}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {showSource && <pre className="reader-mermaid-source"><code>{source}</code></pre>}
      {error && <pre className="reader-mermaid-print-source"><code>{source}</code></pre>}
      {showViewer && <MediaViewerDialog
          content={viewerContent}
          triggerRef={viewerTriggerRef}
          onClose={() => setShowViewer(false)}
        />}
    </section>
  )
}
