import { closeBrackets } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  indentUnit,
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
import { findNext, findPrevious, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { useEffect, useRef } from 'react'

export type CodeMirrorViewState = {
  anchor: number
  head: number
  scrollTop: number
  scrollLeft: number
}

export type CodeMirrorCommands = {
  undo: () => void
  redo: () => void
  search: () => void
  searchNext: () => void
  searchPrevious: () => void
}

type HistoryState = { canUndo: boolean; canRedo: boolean }

interface CodeMirrorEditorProps {
  value: string
  theme: 'light' | 'dark'
  fontSizePx: number
  initialViewState?: CodeMirrorViewState
  onChange: (value: string) => void
  onSave: () => void
  onViewStateChange?: (value: CodeMirrorViewState) => void
  onCommandsReady?: (commands: CodeMirrorCommands | null) => void
  onHistoryChange?: (value: HistoryState) => void
}

function viewState(view: EditorView): CodeMirrorViewState {
  const selection = view.state.selection.main
  return {
    anchor: selection.anchor,
    head: selection.head,
    scrollTop: view.scrollDOM.scrollTop,
    scrollLeft: view.scrollDOM.scrollLeft,
  }
}

export function CodeMirrorEditor({
  value,
  theme,
  fontSizePx,
  initialViewState,
  onChange,
  onSave,
  onViewStateChange,
  onCommandsReady,
  onHistoryChange,
}: CodeMirrorEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onViewStateChangeRef = useRef(onViewStateChange)
  const onCommandsReadyRef = useRef(onCommandsReady)
  const onHistoryChangeRef = useRef(onHistoryChange)
  const styleCompartmentRef = useRef(new Compartment())
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onViewStateChangeRef.current = onViewStateChange
  onCommandsReadyRef.current = onCommandsReady
  onHistoryChangeRef.current = onHistoryChange

  const editorTheme = (dark: boolean, fontSize: number) => [
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.theme({
      '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'var(--paper)', fontSize: `${fontSize}px` },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65', overflow: 'auto' },
      '.cm-content': { minHeight: '100%', padding: '28px 28px 60px 14px', caretColor: 'var(--accent)' },
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
    const selection = initialViewState
      ? {
        anchor: Math.min(value.length, Math.max(0, initialViewState.anchor)),
        head: Math.min(value.length, Math.max(0, initialViewState.head)),
      }
      : undefined
    let view: EditorView
    view = new EditorView({
      state: EditorState.create({
        doc: value,
        selection,
        extensions: [
          styleCompartmentRef.current.of(editorTheme(theme === 'dark', fontSizePx)),
          lineNumbers(),
          foldGutter(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentUnit.of('  '),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          search(),
          markdown(),
          EditorView.lineWrapping,
          keymap.of([
            { key: 'Mod-s', run: () => { onSaveRef.current(); return true } },
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
            if (update.docChanged || update.selectionSet) {
              onViewStateChangeRef.current?.(viewState(update.view))
              onHistoryChangeRef.current?.({
                canUndo: undoDepth(update.state) > 0,
                canRedo: redoDepth(update.state) > 0,
              })
            }
          }),
        ],
      }),
      parent,
    })
    viewRef.current = view
    const saveViewState = () => onViewStateChangeRef.current?.(viewState(view))
    view.scrollDOM.addEventListener('scroll', saveViewState, { passive: true })
    onCommandsReadyRef.current?.({
      undo: () => { undo(view) },
      redo: () => { redo(view) },
      search: () => { openSearchPanel(view) },
      searchNext: () => { findNext(view) },
      searchPrevious: () => { findPrevious(view) },
    })
    onHistoryChangeRef.current?.({ canUndo: false, canRedo: false })
    requestAnimationFrame(() => {
      if (!view.dom.isConnected) return
      view.scrollDOM.scrollTop = initialViewState?.scrollTop ?? 0
      view.scrollDOM.scrollLeft = initialViewState?.scrollLeft ?? 0
      view.focus()
    })

    return () => {
      view.scrollDOM.removeEventListener('scroll', saveViewState)
      saveViewState()
      onCommandsReadyRef.current?.(null)
      onHistoryChangeRef.current?.({ canUndo: false, canRedo: false })
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: styleCompartmentRef.current.reconfigure(editorTheme(theme === 'dark', fontSizePx)) })
  }, [theme, fontSizePx])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return <div className="codemirror-host" ref={mountRef} aria-label="Markdown 源码编辑器" />
}
