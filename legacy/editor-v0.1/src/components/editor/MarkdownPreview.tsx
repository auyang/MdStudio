import { Children, isValidElement, lazy, Suspense, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { DocumentSession } from '../../features/documents/session'
import { imageTitleAndWidth, markdownImageDestinations } from '../../features/documents/markdownImages'

const MermaidDiagram = lazy(() => import('./MermaidDiagram').then(({ MermaidDiagram }) => ({ default: MermaidDiagram })))
const MathRenderer = lazy(() => import('./MathRenderer').then(({ MathRenderer }) => ({ default: MathRenderer })))

const safeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'data', 'blob'],
  },
}

interface MarkdownPreviewProps {
  session: DocumentSession
  className?: string
}

function textContent(value: ReactNode): string {
  return Children.toArray(value).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    if (isValidElement<{ children?: ReactNode }>(child)) return textContent(child.props.children)
    return ''
  }).join('')
}

function CopyableCodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(textContent(children).replace(/\n$/, ''))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="preview-code-block">
      <button type="button" className="code-copy-button" onClick={() => void copy()} aria-label="复制代码块">{copied ? '已复制' : '复制'}</button>
      <pre>{children}</pre>
    </div>
  )
}

export function MarkdownPreview({ session, className = '' }: MarkdownPreviewProps) {
  const [resolvedImages, setResolvedImages] = useState<Record<string, string>>({})
  const destinations = useMemo(() => markdownImageDestinations(session.currentContent), [session.currentContent])

  useEffect(() => {
    let disposed = false
    setResolvedImages({})
    if (!session.filePath || !isTauri()) return

    void Promise.all(destinations.map(async (destination) => {
      try {
        const dataUrl = await invoke<string>('resolve_local_asset', { filePath: session.filePath, relativePath: destination })
        return [destination, dataUrl] as const
      } catch {
        return null
      }
    })).then((results) => {
      if (!disposed) setResolvedImages(Object.fromEntries(results.filter((result): result is readonly [string, string] => result !== null)))
    })

    return () => { disposed = true }
  }, [destinations, session.filePath])

  const components: Components = {
    img: ({ src, alt, title, node: _node, ...props }: ComponentProps<'img'> & { node?: unknown }) => {
      const source = src ?? ''
      const local = !/^(?:https?:|data:|blob:)/i.test(source)
      const resolved = resolvedImages[source]
      const imageMeta = imageTitleAndWidth(title)
      if (local && session.filePath && isTauri() && !resolved) {
        return <span className="image-fallback">图片暂不可用：{alt || source}</span>
      }
      return (
        <img
          src={resolved ?? source}
          alt={alt ?? ''}
          title={imageMeta.title || undefined}
          width={imageMeta.width ?? undefined}
          loading="lazy"
          {...props}
        />
      )
    },
    a: ({ href, children, node: _node, ...props }) => (
      <a href={href} target={href?.startsWith('https://') ? '_blank' : undefined} rel="noreferrer" {...props}>
        {children}
      </a>
    ),
    p: ({ children }) => (
      <p>{Children.map(children, (child) => {
        if (isValidElement<{ className?: string; children?: ReactNode }>(child)
          && child.props.className?.includes('language-math')) {
          return <Suspense fallback={<code>{child.props.children}</code>}><MathRenderer source={textContent(child.props.children)} /></Suspense>
        }
        return child
      })}</p>
    ),
    code: ({ className: codeClass, children }) => {
      return <code className={codeClass}>{children}</code>
    },
    pre: ({ children }) => {
      const codeElement = Children.toArray(children).find((child) => isValidElement<{ className?: string; children?: ReactNode }>(child))
      const codeProps = isValidElement<{ className?: string; children?: ReactNode }>(codeElement) ? codeElement.props : null
      const codeClass = codeProps?.className ?? ''
      const source = textContent(codeProps?.children ?? children).replace(/\n$/, '')

      if (codeClass.includes('language-mermaid')) {
        return <Suspense fallback={<div className="advanced-loading">正在加载图表预览…</div>}><MermaidDiagram source={source} /></Suspense>
      }
      if (codeClass.includes('language-math')) {
        return <Suspense fallback={<div className="advanced-loading">正在排版公式…</div>}><MathRenderer source={source} display /></Suspense>
      }
      return <CopyableCodeBlock>{children}</CopyableCodeBlock>
    },
  }

  return (
    <div className={`markdown-preview ${className}`} aria-label="Markdown 实时预览">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeSanitize, safeSchema]]} components={components}>
        {session.currentContent}
      </ReactMarkdown>
    </div>
  )
}
