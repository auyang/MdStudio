export type ReaderTabStatus = 'loading' | 'ready' | 'error' | 'missing'

export type ReaderReadingState = {
  scrollTop: number
  scrollRatio: number
  headingId?: string
  headingOffset?: number
  searchOpen: boolean
  searchQuery: string
  searchMatchIndex: number
  searchMatchCount: number
  tocOpen: boolean
}

export type ReaderTab<TDocument> = {
  id: string
  canonicalPath: string
  displayName: string
  status: ReaderTabStatus
  stale: boolean
  error?: string
  document: TDocument | null
  reading: ReaderReadingState
}

export type ReaderTabsState<TDocument> = {
  tabs: ReaderTab<TDocument>[]
  activeTabId: string | null
  recentActivationOrder: string[]
}

export function emptyReaderTabs<TDocument>(): ReaderTabsState<TDocument> {
  return { tabs: [], activeTabId: null, recentActivationOrder: [] }
}

function touchRecent<TDocument>(state: ReaderTabsState<TDocument>, id: string): string[] {
  return [id, ...state.recentActivationOrder.filter(existing => existing !== id && state.tabs.some(tab => tab.id === existing))]
}

export function addOrActivateTab<TDocument>(
  state: ReaderTabsState<TDocument>,
  tab: ReaderTab<TDocument>,
): { state: ReaderTabsState<TDocument>; tab: ReaderTab<TDocument>; created: boolean } {
  const existing = state.tabs.find(item => item.canonicalPath === tab.canonicalPath)
  if (existing) {
    return {
      state: { ...state, activeTabId: existing.id, recentActivationOrder: touchRecent(state, existing.id) },
      tab: existing,
      created: false,
    }
  }
  const next = { ...state, tabs: [...state.tabs, tab], activeTabId: tab.id }
  return { state: { ...next, recentActivationOrder: touchRecent(next, tab.id) }, tab, created: true }
}

export function activateReaderTab<TDocument>(state: ReaderTabsState<TDocument>, id: string): ReaderTabsState<TDocument> {
  if (!state.tabs.some(tab => tab.id === id)) return state
  return { ...state, activeTabId: id, recentActivationOrder: touchRecent(state, id) }
}

export function updateReaderTab<TDocument>(
  state: ReaderTabsState<TDocument>,
  id: string,
  update: (tab: ReaderTab<TDocument>) => ReaderTab<TDocument>,
): ReaderTabsState<TDocument> {
  if (!state.tabs.some(tab => tab.id === id)) return state
  return { ...state, tabs: state.tabs.map(tab => tab.id === id ? update(tab) : tab) }
}

export function closeReaderTab<TDocument>(
  state: ReaderTabsState<TDocument>,
  id: string,
): { state: ReaderTabsState<TDocument>; closed: ReaderTab<TDocument> | null } {
  const index = state.tabs.findIndex(tab => tab.id === id)
  if (index < 0) return { state, closed: null }
  const closed = state.tabs[index]
  const tabs = state.tabs.filter(tab => tab.id !== id)
  if (state.activeTabId !== id) {
    return {
      state: {
        ...state,
        tabs,
        recentActivationOrder: state.recentActivationOrder.filter(existing => existing !== id),
      },
      closed,
    }
  }

  const recent = state.recentActivationOrder.find(existing => existing !== id && tabs.some(tab => tab.id === existing))
  const adjacent = tabs[Math.min(index, tabs.length - 1)] ?? tabs[index - 1]
  const activeTabId = recent ?? adjacent?.id ?? null
  const next = {
    ...state,
    tabs,
    activeTabId,
    recentActivationOrder: state.recentActivationOrder.filter(existing => existing !== id),
  }
  return {
    state: activeTabId ? { ...next, recentActivationOrder: touchRecent(next, activeTabId) } : next,
    closed,
  }
}
