import { useEffect, useRef } from 'react'
import { closeBrackets } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'

interface CodeMirrorEditorProps {
  value: string
  theme: 'light' | 'dark'
  onChange: (value: string) => void
  onViewReady?: (view: EditorView | null) => void
  onSearchReady?: (search: (() => void) | null) => void
}

export function CodeMirrorEditor({ value, theme, onChange, onViewReady, onSearchReady }: CodeMirrorEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onViewReadyRef = useRef(onViewReady)
  const onSearchReadyRef = useRef(onSearchReady)
  const themeCompartmentRef = useRef(new Compartment())
  onChangeRef.current = onChange
  onViewReadyRef.current = onViewReady
  onSearchReadyRef.current = onSearchReady

  const editorTheme = (dark: boolean) => [
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.theme({
      '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'var(--paper)' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.78', overflow: 'auto' },
      '.cm-content': { minHeight: '100%', padding: '34px 28px 60px 16px', caretColor: 'var(--accent)' },
      '.cm-gutters': { backgroundColor: 'var(--paper)', color: 'var(--muted)', border: 'none' },
      '.cm-activeLine': { backgroundColor: 'var(--line-wash)' },
      '.cm-activeLineGutter': { backgroundColor: 'var(--line-wash)', color: 'var(--ink-soft)' },
      '&.cm-focused': { outline: 'none' },
      '.cm-cursor': { borderLeftColor: 'var(--accent)' },
      '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection)' },
      '.cm-searchMatch': { backgroundColor: 'var(--selection)' },
    }, { dark }),
  ]

  useEffect(() => {
    const parent = mountRef.current
    if (!parent) return

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          themeCompartmentRef.current.of(editorTheme(theme === 'dark')),
          lineNumbers(),
          foldGutter(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          search(),
          markdown(),
          EditorView.lineWrapping,
          keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
      parent,
    })
    viewRef.current = view
    onViewReadyRef.current?.(view)
    onSearchReadyRef.current?.(() => openSearchPanel(view))

    return () => {
      onViewReadyRef.current?.(null)
      onSearchReadyRef.current?.(null)
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: themeCompartmentRef.current.reconfigure(editorTheme(theme === 'dark')) })
  }, [theme])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return <div className="codemirror-host" ref={mountRef} aria-label="Markdown 源码编辑器" />
}
