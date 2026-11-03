import { useEffect, useRef, useState } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { goToNextChunk, goToPreviousChunk, MergeView } from '@codemirror/merge'

interface DiffViewerProps {
  leftLabel: string
  rightLabel: string
  leftText: string
  rightText: string
}

const MAX_DIFF_CHARACTERS = 1_000_000

export function DiffViewer({ leftLabel, rightLabel, leftText, rightText }: DiffViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<MergeView | null>(null)
  const [changeCount, setChangeCount] = useState(0)
  const oversized = leftText.length + rightText.length > MAX_DIFF_CHARACTERS

  useEffect(() => {
    const parent = hostRef.current
    if (!parent || oversized) return
    const readOnly = [markdown(), EditorState.readOnly.of(true), EditorView.editable.of(false)]
    const view = new MergeView({
      a: { doc: leftText, extensions: readOnly },
      b: { doc: rightText, extensions: readOnly },
      parent,
      orientation: 'a-b',
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
      diffConfig: { scanLimit: 1000 },
    })
    viewRef.current = view
    setChangeCount(view.chunks.length)
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [leftText, rightText, oversized])

  if (oversized) {
    return <div className="diff-too-large">文档差异超过 1 MB；为保持界面响应，暂不生成双栏差异视图。两份原文仍保留，可另存或在源码模式比较。</div>
  }

  return (
    <section className="diff-viewer" aria-label="文档差异">
      <div className="diff-pane-labels"><span>{leftLabel}</span><span>{rightLabel}</span></div>
      <div className="diff-actions">
        <button onClick={() => viewRef.current && goToPreviousChunk(viewRef.current.b)}>上一处差异</button>
        <span>{changeCount} 处差异</span>
        <button onClick={() => viewRef.current && goToNextChunk(viewRef.current.b)}>下一处差异</button>
      </div>
      <div className="diff-editor-host" ref={hostRef} />
    </section>
  )
}

