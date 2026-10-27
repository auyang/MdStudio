import { describe, expect, it } from 'vitest'
import {
  activateReaderTab,
  addOrActivateTab,
  closeReaderTab,
  emptyReaderTabs,
  type ReaderTab,
} from './tabs'

function tab(id: string): ReaderTab<string> {
  return {
    id,
    canonicalPath: `/${id}.md`,
    displayName: `${id}.md`,
    status: 'ready',
    stale: false,
    document: id,
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
})
