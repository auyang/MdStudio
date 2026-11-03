import { describe, expect, it } from 'vitest'
import {
  activateReaderTab,
  addOrActivateTab,
  closeReaderTab,
  emptyReaderTabs,
  type ReaderTab,
} from './tabs'
import type { DocumentType } from '../documents/core/types'

function tab(id: string, documentType: DocumentType = 'markdown'): ReaderTab<string> {
  const extension = documentType === 'markdown' ? 'md' : documentType
  return {
    id,
    canonicalPath: `/${id}.${extension}`,
    documentType,
    displayName: `${id}.${extension}`,
    status: 'ready',
    stale: false,
    document: id,
    session: null,
    reading: { scrollTop: 0, scrollRatio: 0, searchOpen: false, searchQuery: '', searchMatchIndex: 0, searchMatchCount: 0, tocOpen: false },
  }
}

describe('reader tab state transitions', () => {
  it('deduplicates by canonical path and activates the existing tab', () => {
    let state = emptyReaderTabs<string>()
    state = addOrActivateTab(state, tab('a')).state
    state = addOrActivateTab(state, tab('b')).state
    const duplicate = addOrActivateTab(state, { ...tab('a'), displayName: 'renamed.md' })
    expect(duplicate.created).toBe(false)
    expect(duplicate.state.tabs).toHaveLength(2)
    expect(duplicate.state.activeTabId).toBe('a')
    expect(duplicate.tab.displayName).toBe('a.md')
  })

  it('closes the active tab to the most recently activated remaining tab', () => {
    let state = emptyReaderTabs<string>()
    state = addOrActivateTab(state, tab('a')).state
    state = addOrActivateTab(state, tab('b')).state
    state = addOrActivateTab(state, tab('c')).state
    state = activateReaderTab(state, 'a')
    state = activateReaderTab(state, 'c')
    const result = closeReaderTab(state, 'c')
    expect(result.closed?.id).toBe('c')
    expect(result.state.activeTabId).toBe('a')
  })

  it('closing a background tab does not change the active tab', () => {
    let state = emptyReaderTabs<string>()
    state = addOrActivateTab(state, tab('a')).state
    state = addOrActivateTab(state, tab('b')).state
    const result = closeReaderTab(state, 'a')
    expect(result.state.activeTabId).toBe('b')
    expect(result.state.tabs.map(item => item.id)).toEqual(['b'])
  })

  it('falls back to an adjacent tab when there is no activation history', () => {
    let state = emptyReaderTabs<string>()
    state = { ...state, tabs: [tab('a'), tab('b'), tab('c')], activeTabId: 'b' }
    expect(closeReaderTab(state, 'b').state.activeTabId).toBe('c')
  })

  it('保留跨格式 tab 类型字段并复用统一的去重与关闭行为', () => {
    let state = emptyReaderTabs<string>()
    state = addOrActivateTab(state, tab('notes', 'markdown')).state
    state = addOrActivateTab(state, tab('report', 'pdf')).state
    state = addOrActivateTab(state, tab('invoice', 'ofd')).state

    const duplicate = addOrActivateTab(state, tab('report', 'pdf'))
    expect(duplicate.created).toBe(false)
    expect(duplicate.state.tabs.map(item => item.documentType)).toEqual(['markdown', 'pdf', 'ofd'])

    const closed = closeReaderTab(duplicate.state, 'invoice')
    expect(closed.closed?.documentType).toBe('ofd')
    expect(closed.state.activeTabId).toBe('report')
  })
})
