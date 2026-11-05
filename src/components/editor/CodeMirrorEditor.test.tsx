// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import type { CodeMirrorCommands } from './CodeMirrorEditor'

let host: HTMLDivElement
let root: Root
let commands: CodeMirrorCommands | null
const onChange = vi.fn()
const onSave = vi.fn()
const onViewStateChange = vi.fn()
const onHistoryChange = vi.fn()

function renderEditor() {
  act(() => root.render(<CodeMirrorEditor
    value={'# 标题\n原始内容'}
    theme="light"
    fontSizePx={14}
    onChange={onChange}
    onSave={onSave}
    onViewStateChange={onViewStateChange}
    onCommandsReady={value => { commands = value }}
    onHistoryChange={onHistoryChange}
  />))
}

describe('CodeMirror Markdown 源码编辑器', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    commands = null
    onChange.mockReset()
    onSave.mockReset()
    onViewStateChange.mockReset()
    onHistoryChange.mockReset()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, toJSON: () => ({}) }) })
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    host?.remove()
    vi.unstubAllGlobals()
  })

  it('提供源码、行号、撤销重做、搜索、保存快捷键和视图状态回调', async () => {
    await act(async () => renderEditor())
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)
    expect(view).not.toBeNull()
    expect(host.querySelector('.cm-gutters')?.textContent).toContain('1')
    expect(view!.state.doc.toString()).toBe('# 标题\n原始内容')

    await act(async () => {
      view!.dispatch({ changes: { from: view!.state.doc.length, insert: '\n新增内容' } })
    })
    expect(onChange).toHaveBeenLastCalledWith('# 标题\n原始内容\n新增内容')
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false })
    expect(onViewStateChange).toHaveBeenCalled()

    await act(async () => commands!.undo())
    expect(view!.state.doc.toString()).toBe('# 标题\n原始内容')
    await act(async () => commands!.redo())
    expect(view!.state.doc.toString()).toBe('# 标题\n原始内容\n新增内容')

    await act(async () => commands!.search())
    expect(host.querySelector('.cm-search')).not.toBeNull()
    await act(async () => {
      view!.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
