import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  FileDown,
  FileText,
  ListTree,
  LoaderCircle,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import type { ReaderTabStatus } from '../../features/reader/tabs'
import type { ThemePreference } from '../../features/reader/preferences'
import { useI18n } from '../../features/i18n'

export type HeaderTab = {
  id: string
  canonicalPath: string
  displayName: string
  status: ReaderTabStatus
  stale: boolean
}

type AppHeaderProps = {
  logo: ReactNode
  tabs: HeaderTab[]
  activeTabId: string | null
  loading: boolean
  searchOpen: boolean
  searchQuery: string
  searchIndex: number
  searchCount: number
  searchPending: boolean
  tocOpen: boolean
  theme: ThemePreference
  doubleClickToClose: boolean
  searchInputRef: RefObject<HTMLInputElement | null>
  canGoBack: boolean
  canGoForward: boolean
  navigationBusy: boolean
  canExportPdf: boolean
  exportingPdf: boolean
  onGoBack: () => void
  onGoForward: () => void
  onExportPdf: () => void
  onRefresh: () => void
  onToggleSearch: () => void
  onToggleToc: () => void
  onCycleTheme: () => void
  onOpenSettings: () => void
  onOpenFile: () => void
  onSearchQueryChange: (query: string) => void
  onSearchPrevious: () => void
  onSearchNext: () => void
  onSearchClear: () => void
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  onCloseSearch: () => void
  onActivateTab: (id: string) => void
  onCloseTab: (id: string) => void
}

function tabLabel(tab: HeaderTab, tabs: HeaderTab[]): string {
  const sameName = tabs.filter(item => item.displayName === tab.displayName)
  if (sameName.length < 2) return tab.displayName
  const parents = tab.canonicalPath.split(/[\\/]/).filter(Boolean).slice(0, -1)
  const suffixFor = (item: HeaderTab, depth: number) => item.canonicalPath
    .split(/[\\/]/).filter(Boolean).slice(0, -1).slice(-depth).reverse().join('/')
  for (let depth = 1; depth <= parents.length; depth += 1) {
    const suffix = suffixFor(tab, depth)
    if (sameName.every(item => item.id === tab.id || suffixFor(item, depth) !== suffix)) {
      return `${tab.displayName} · ${suffix}`
    }
  }
  return `${tab.displayName} · ${parents.join('/')}`
}

export function AppHeader({
  logo,
  tabs,
  activeTabId,
  loading,
  searchOpen,
  searchQuery,
  searchIndex,
  searchCount,
  searchPending,
  tocOpen,
  theme,
  doubleClickToClose,
  searchInputRef,
  canGoBack,
  canGoForward,
  navigationBusy,
  canExportPdf,
  exportingPdf,
  onGoBack,
  onGoForward,
  onExportPdf,
  onRefresh,
  onToggleSearch,
  onToggleToc,
  onCycleTheme,
  onOpenSettings,
  onOpenFile,
  onSearchQueryChange,
  onSearchPrevious,
  onSearchNext,
  onSearchClear,
  onSearchKeyDown,
  onCloseSearch,
  onActivateTab,
  onCloseTab,
}: AppHeaderProps) {
  const t = useI18n()
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDetailsElement>(null)
  const tabClickTimers = useRef(new Map<string, number>())
  const themeLabel = t(theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色')
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon

  const clearPendingTabClicks = () => {
    for (const timer of tabClickTimers.current.values()) window.clearTimeout(timer)
    tabClickTimers.current.clear()
  }

  useEffect(() => () => clearPendingTabClicks(), [])

  useLayoutEffect(() => {
    const alignTabs = () => {
      const viewport = tabsScrollRef.current
      const activeTab = viewport?.querySelector<HTMLElement>('.reader-tab-item.is-active')
      if (!viewport || !activeTab || viewport.clientWidth === 0) return
      const viewportRect = viewport.getBoundingClientRect()
      const items = Array.from(viewport.querySelectorAll<HTMLElement>('.reader-tab-item'))
      const activeIndex = items.indexOf(activeTab)
      let activeRect = activeTab.getBoundingClientRect()

      if (activeRect.left < viewportRect.left) {
        viewport.scrollLeft += activeRect.left - viewportRect.left
      } else if (activeRect.right > viewportRect.right) {
        let firstVisibleIndex = activeIndex
        let visibleWidth = activeTab.offsetWidth + 2
        while (firstVisibleIndex > 0) {
          const previousWidth = items[firstVisibleIndex - 1].offsetWidth + 2
          if (visibleWidth + previousWidth > viewport.clientWidth) break
          visibleWidth += previousWidth
          firstVisibleIndex -= 1
        }
        const firstTab = items[firstVisibleIndex] ?? activeTab
        viewport.scrollLeft += firstTab.getBoundingClientRect().left - viewportRect.left
      }

      activeRect = activeTab.getBoundingClientRect()
      const firstVisibleTab = items.find(item => item.getBoundingClientRect().right > viewportRect.left + 1)
      const firstRect = firstVisibleTab?.getBoundingClientRect()
      if (firstVisibleTab && firstRect && firstRect.left < viewportRect.left - 1) {
        const alignFirstDelta = firstRect.left - viewportRect.left
        if (activeRect.right - alignFirstDelta <= viewportRect.right + 1) {
          viewport.scrollLeft += alignFirstDelta
        } else {
          const hideFirstDelta = firstRect.right - viewportRect.left
          if (activeRect.left - hideFirstDelta >= viewportRect.left - 1) {
            viewport.scrollLeft += hideFirstDelta
          }
        }
      }
    }

    alignTabs()
    const frame = requestAnimationFrame(alignTabs)
    window.addEventListener('resize', alignTabs)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', alignTabs)
    }
  }, [activeTabId, tabs.length])

  const closeMoreMenu = () => {
    if (moreMenuRef.current) moreMenuRef.current.open = false
  }

  return (
    <header className="reader-topbar" onClickCapture={event => {
      if (!(event.target as HTMLElement).closest('.reader-tab')) clearPendingTabClicks()
    }}>
      <div className="brand-area">
        <a className="brand-home" href="#home" aria-label={t('MdStudio 首页')} onClick={event => {
          event.preventDefault()
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}>{logo}</a>
      </div>

      <div className="reader-tabs">
        <div ref={tabsScrollRef} className={'reader-tabs-scroll' + (tabs.length > 1 ? ' has-multiple-tabs' : '')} role="tablist" aria-label={t('打开的 Markdown 文档')}>
          {tabs.map((tab, index) => <div className={'reader-tab-item' + (tab.id === activeTabId ? ' is-active' : '')} key={tab.id}>
              <button
              type="button"
              className="reader-tab"
              role="tab"
              id={`reader-tab-${index}`}
              aria-controls="reader-tabpanel"
              aria-selected={tab.id === activeTabId}
              tabIndex={tab.id === activeTabId ? 0 : -1}
              title={tab.canonicalPath}
              onClick={event => {
                clearPendingTabClicks()
                if (!doubleClickToClose || event.detail === 0) {
                  onActivateTab(tab.id)
                  return
                }
                if (event.detail > 1) return
                const timer = window.setTimeout(() => {
                  tabClickTimers.current.delete(tab.id)
                  onActivateTab(tab.id)
                }, 240)
                tabClickTimers.current.set(tab.id, timer)
              }}
              onDoubleClick={event => {
                event.preventDefault()
                event.stopPropagation()
                clearPendingTabClicks()
                if (doubleClickToClose) onCloseTab(tab.id)
              }}
              onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                const nextTab = tabs[nextIndex]
                onActivateTab(nextTab.id)
                requestAnimationFrame(() => document.getElementById(`reader-tab-${nextIndex}`)?.focus())
              }}
            >
              <FileText size={14} aria-hidden="true" />
              <span>{tabLabel(tab, tabs)}</span>
              {tab.status === 'loading' && <LoaderCircle className="is-spinning" size={12} aria-label={t('正在加载')} />}
              {tab.status === 'error' && <span className="reader-tab-indicator is-error" aria-label={t('读取失败')} />}
              {(tab.status === 'missing' || tab.stale) && <span className="reader-tab-indicator is-stale" aria-label={t(tab.status === 'missing' ? '文件已删除' : '文件已更改')} />}
            </button>
            <button
              type="button"
              className="reader-tab-close"
              aria-label={t('关闭 {name}', { name: tab.displayName })}
              title={t('关闭 {name}', { name: tab.displayName })}
              onClick={event => {
                event.stopPropagation()
                clearPendingTabClicks()
                if (event.detail > 1) return
                onCloseTab(tab.id)
              }}
              onDoubleClick={event => { event.preventDefault(); event.stopPropagation() }}
            ><X size={13} /></button>
          </div>)}
        </div>
        <button
          type="button"
          className="reader-tabs-add"
          aria-label={t('打开 Markdown 文件（Ctrl/Cmd+O）')}
          title={t('打开 Markdown 文件（Ctrl/Cmd+O）')}
          onClick={event => { if (event.detail <= 1) onOpenFile() }}
          onDoubleClick={event => { event.preventDefault(); event.stopPropagation() }}
        ><Plus size={16} /></button>
      </div>

      <div className="topbar-actions">
        {searchOpen && <div className={'search-box' + (searchPending ? ' is-pending' : '')} role="search" aria-label={t('搜索当前文档')}>
          <Search size={15} aria-hidden="true" />
          <input ref={searchInputRef} type="search" autoComplete="off" spellCheck={false} enterKeyHint="search" value={searchQuery} onChange={event => onSearchQueryChange(event.target.value)} onKeyDown={onSearchKeyDown} placeholder={t('搜索本文')} aria-label={t('搜索本文')} aria-describedby="search-result-status" />
          <span className="search-count" id="search-result-status" role="status" aria-live="polite" aria-atomic="true" aria-label={searchPending ? t('正在搜索') : searchQuery.trim() && !searchCount ? t('0 / 0，无匹配结果') : undefined}>{searchPending ? t('搜索中…') : `${searchCount ? searchIndex + 1 : 0} / ${searchCount}`}</span>
          {!searchPending && searchQuery.trim() && !searchCount && <span className="search-empty" aria-hidden="true">{t('无结果')}</span>}
          <button type="button" className="icon-button compact" onClick={onSearchClear} disabled={!searchQuery} aria-label={t('清空搜索')} title={t('清空搜索')}><Eraser size={15} /></button>
          <button className="icon-button compact" onClick={onSearchPrevious} disabled={!searchCount} aria-label={t('上一个匹配')}><ChevronLeft size={16} /></button>
          <button className="icon-button compact" onClick={onSearchNext} disabled={!searchCount} aria-label={t('下一个匹配')}><ChevronRight size={16} /></button>
          <button className="icon-button compact" onClick={onCloseSearch} aria-label={t('关闭搜索')}><X size={15} /></button>
        </div>}
        {tabs.length > 0 && <button className="icon-button" onClick={onGoBack} disabled={!canGoBack || navigationBusy} title={t('后退（⌘[ / Alt+←）')} aria-label={t('后退')}><ArrowLeft size={17} /></button>}
        {tabs.length > 0 && <button className="icon-button" onClick={onGoForward} disabled={!canGoForward || navigationBusy} title={t('前进（⌘] / Alt+→）')} aria-label={t('前进')}><ArrowRight size={17} /></button>}
        {tabs.length > 0 && <button className="icon-button" onClick={onRefresh} title={t('刷新文档（⌘R / Ctrl+R）')} aria-label={t('刷新文档')}><RefreshCw className={loading ? 'is-spinning' : ''} size={17} /></button>}
        {tabs.length > 0 && <button className={'icon-button' + (searchOpen ? ' is-active' : '')} onClick={onToggleSearch} title={t('搜索本文（⌘F / Ctrl+F）')} aria-label={t('搜索本文')}><Search size={17} /></button>}
        {canExportPdf && <button className="icon-button toolbar-secondary" onClick={onExportPdf} disabled={exportingPdf} title={t(exportingPdf ? '正在导出 PDF…' : '导出 PDF')} aria-label={t(exportingPdf ? '正在导出 PDF…' : '导出 PDF')}>{exportingPdf ? <LoaderCircle className="is-spinning" size={17} /> : <FileDown size={17} />}</button>}
        {tabs.length > 0 && <button className={'icon-button toolbar-secondary' + (tocOpen ? ' is-active' : '')} onClick={onToggleToc} title={t('文档目录')} aria-label={t('文档目录')}><ListTree size={17} /></button>}
        <button className="theme-button toolbar-secondary" onClick={onCycleTheme} title={t('主题：{theme}，点击切换', { theme: themeLabel })} aria-label={t('主题：{theme}，点击切换', { theme: themeLabel })}>
          <ThemeIcon size={16} />
          <ChevronDown size={12} />
        </button>
        <button className="icon-button settings-open-button toolbar-secondary" onClick={onOpenSettings} title={t('设置（⌘, / Ctrl+,）')} aria-label={t('打开设置')}><Settings2 size={17} /></button>

        <details ref={moreMenuRef} className="topbar-more">
          <summary className="icon-button topbar-more-trigger" aria-label={t('更多阅读工具')} title={t('更多阅读工具')}><MoreHorizontal size={18} /></summary>
          <div className="topbar-more-panel" role="group" aria-label={t('更多阅读工具')}>
            {canExportPdf && <button className="icon-button" onClick={() => { closeMoreMenu(); onExportPdf() }} disabled={exportingPdf} title={t(exportingPdf ? '正在导出 PDF…' : '导出 PDF')} aria-label={t(exportingPdf ? '正在导出 PDF…' : '导出 PDF')}><FileDown size={17} /><span className="topbar-more-label">{t(exportingPdf ? '正在导出 PDF…' : '导出 PDF')}</span></button>}
            <button className={'icon-button' + (tocOpen ? ' is-active' : '')} onClick={() => { closeMoreMenu(); onToggleToc() }} title={t('文档目录')} aria-label={t('文档目录')} disabled={tabs.length === 0}><ListTree size={17} /><span className="topbar-more-label">{t('文档目录')}</span></button>
            <button className="theme-button" onClick={() => { closeMoreMenu(); onCycleTheme() }} title={t('主题：{theme}，点击切换', { theme: themeLabel })} aria-label={t('主题：{theme}，点击切换', { theme: themeLabel })}>
              <ThemeIcon size={16} />
              <ChevronDown size={12} />
              <span className="topbar-more-label">{t('主题')}: {themeLabel}</span>
            </button>
            <button className="icon-button settings-open-button" onClick={() => { closeMoreMenu(); onOpenSettings() }} title={t('设置（⌘, / Ctrl+,）')} aria-label={t('打开设置')}><Settings2 size={17} /><span className="topbar-more-label">{t('设置')}</span></button>
          </div>
        </details>
      </div>
    </header>
  )
}
