import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eraser,
  FileDown,
  FileText,
  ListTree,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Redo2,
  RotateCw,
  Save,
  Search,
  X,
  ZoomIn,
  ZoomOut,
  Undo2,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import type { ReaderTabStatus } from '../../features/reader/tabs'
import type { DocumentType } from '../../features/documents/core/types'
import { useI18n } from '../../features/i18n'

export type HeaderTab = {
  id: string
  canonicalPath: string
  displayName: string
  status: ReaderTabStatus
  stale: boolean
  documentType: DocumentType
  dirty?: boolean
}

type MarkdownMode = 'read' | 'edit'

type AppHeaderProps = {
  logo: ReactNode
  onGoHome?: () => void
  tabs: HeaderTab[]
  activeTabId: string | null
  loading: boolean
  searchOpen: boolean
  searchQuery: string
  searchIndex: number
  searchCount: number
  searchPending: boolean
  tocOpen: boolean
  canToggleNavigation: boolean
  canSearch: boolean
  navigationLabel: string
  activeDocumentType: DocumentType | null
  doubleClickToClose: boolean
  searchInputRef: RefObject<HTMLInputElement | null>
  searchToggleRef: RefObject<HTMLButtonElement | null>
  canGoBack: boolean
  canGoForward: boolean
  navigationBusy: boolean
  canExportPdf: boolean
  exportingPdf: boolean
  markdownMode?: MarkdownMode
  markdownDirty?: boolean
  markdownCanUndo?: boolean
  markdownCanRedo?: boolean
  pagedControls?: {
    documentType: 'pdf' | 'ofd'
    page: number
    pageCount: number
    scale: number
    minScale: number
    maxScale: number
    onPageChange: (page: number) => void
    onZoomIn: () => void
    onZoomOut: () => void
    onRotate: () => void
    onResetZoom: () => void
  }
  onGoBack: () => void
  onGoForward: () => void
  onExportPdf: () => void
  onRefresh: () => void
  onToggleSearch: () => void
  onToggleToc: () => void
  onOpenFile: () => void
  onSearchQueryChange: (query: string) => void
  onSearchPrevious: () => void
  onSearchNext: () => void
  onSearchClear: () => void
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  onCloseSearch: () => void
  onActivateTab: (id: string) => void
  onCloseTab: (id: string) => void
  onSetMarkdownMode?: (mode: MarkdownMode) => void
  onSaveMarkdown?: () => void
  onSaveMarkdownAs?: () => void
  onNewMarkdown?: () => void
  onUndoMarkdown?: () => void
  onRedoMarkdown?: () => void
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
  onGoHome,
  tabs,
  activeTabId,
  loading,
  searchOpen,
  searchQuery,
  searchIndex,
  searchCount,
  searchPending,
  tocOpen,
  canToggleNavigation,
  canSearch,
  navigationLabel,
  activeDocumentType,
  doubleClickToClose,
  searchInputRef,
  searchToggleRef,
  canGoBack,
  canGoForward,
  navigationBusy,
  canExportPdf,
  exportingPdf,
  markdownMode = 'read',
  markdownDirty = false,
  markdownCanUndo = false,
  markdownCanRedo = false,
  pagedControls,
  onGoBack,
  onGoForward,
  onExportPdf,
  onRefresh,
  onToggleSearch,
  onToggleToc,
  onOpenFile,
  onSearchQueryChange,
  onSearchPrevious,
  onSearchNext,
  onSearchClear,
  onSearchKeyDown,
  onCloseSearch,
  onActivateTab,
  onCloseTab,
  onSetMarkdownMode,
  onSaveMarkdown,
  onSaveMarkdownAs,
  onNewMarkdown,
  onUndoMarkdown,
  onRedoMarkdown,
}: AppHeaderProps) {
  const t = useI18n()
  const isMacWindow = isTauri() && /Macintosh|Mac OS/i.test(navigator.userAgent)
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDetailsElement>(null)
  const tabClickTimers = useRef(new Map<string, number>())

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
    <header className={'reader-topbar' + (isMacWindow ? ' is-macos' : '')} data-tauri-drag-region={isMacWindow ? 'deep' : undefined} onClickCapture={event => {
      if (!(event.target as HTMLElement).closest('.reader-tab')) clearPendingTabClicks()
    }}>
      <div className="brand-area" data-tauri-drag-region={isMacWindow ? '' : undefined}>
        <a className="brand-home" href="#home" aria-label={t('MdStudio 首页')} onClick={event => {
          event.preventDefault()
          if (onGoHome) onGoHome()
          else window.scrollTo({ top: 0, behavior: 'smooth' })
        }}>{logo}</a>
      </div>

      <div className="reader-tabs">
        <div ref={tabsScrollRef} className={'reader-tabs-scroll' + (tabs.length > 1 ? ' has-multiple-tabs' : '')} data-tauri-drag-region={isMacWindow ? '' : undefined} role="tablist" aria-label={t('打开的文档')}>
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
              {tab.dirty && <span className="reader-tab-dirty" aria-label={t('未保存')} title={t('未保存')}>●</span>}
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
          aria-label={t('打开文档（Ctrl/Cmd+O）')}
          title={t('打开文档（Ctrl/Cmd+O）')}
          onClick={event => { if (event.detail <= 1) onOpenFile() }}
          onDoubleClick={event => { event.preventDefault(); event.stopPropagation() }}
        ><Plus size={16} /></button>
      </div>

      <div className="topbar-actions">
        {pagedControls && <PagedToolbar {...pagedControls} compactForMac={isMacWindow} />}
        {activeDocumentType === 'markdown' && onSetMarkdownMode && <div className="markdown-toolbar-tools" role="group" aria-label={t('Markdown 编辑工具')}>
          <div className="markdown-mode-switch" role="group" aria-label={t('Markdown 模式')}>
            <button type="button" className={markdownMode === 'read' ? 'is-selected' : ''} aria-pressed={markdownMode === 'read'} onClick={() => onSetMarkdownMode('read')} title={t('阅读模式')}><BookOpen size={14} /><span>{t('阅读')}</span></button>
            <button type="button" className={markdownMode === 'edit' ? 'is-selected' : ''} aria-pressed={markdownMode === 'edit'} onClick={() => onSetMarkdownMode('edit')} title={t('编辑模式')}><Code2 size={14} /><span>{t('编辑')}</span></button>
          </div>
          {markdownMode === 'edit' && <>
            <button type="button" className="icon-button compact markdown-save-button" onClick={onSaveMarkdown} disabled={!markdownDirty} title={t('保存 Markdown（⌘S / Ctrl+S）')} aria-label={t('保存 Markdown')}><Save size={15} /></button>
            <button type="button" className="icon-button compact toolbar-secondary" onClick={onUndoMarkdown} disabled={!markdownCanUndo} title={t('撤销')} aria-label={t('撤销')}><Undo2 size={15} /></button>
            <button type="button" className="icon-button compact toolbar-secondary" onClick={onRedoMarkdown} disabled={!markdownCanRedo} title={t('重做')} aria-label={t('重做')}><Redo2 size={15} /></button>
          </>}
        </div>}
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
        {tabs.length > 0 && canSearch && activeDocumentType && <button ref={searchToggleRef} className={'icon-button' + (searchOpen ? ' is-active' : '')} onClick={onToggleSearch} title={t('搜索本文（⌘F / Ctrl+F）')} aria-label={t('搜索本文')}><Search size={17} /></button>}
        {canExportPdf && <button className="icon-button toolbar-secondary" onClick={onExportPdf} disabled={exportingPdf} title={t(exportingPdf ? '正在导出 PDF…' : '导出 PDF')} aria-label={t(exportingPdf ? '正在导出 PDF…' : '导出 PDF')}>{exportingPdf ? <LoaderCircle className="is-spinning" size={17} /> : <FileDown size={17} />}</button>}
        {tabs.length > 0 && canToggleNavigation && <button className={'icon-button toolbar-secondary' + (tocOpen ? ' is-active' : '')} onClick={onToggleToc} title={navigationLabel} aria-label={navigationLabel}><ListTree size={17} /></button>}
        <details ref={moreMenuRef} className="topbar-more" data-dismiss-outside>
          <summary className="icon-button topbar-more-trigger" aria-label={t('更多阅读工具')} title={t('更多阅读工具')}><MoreHorizontal size={18} /></summary>
          <div className="topbar-more-panel" role="group" aria-label={t('更多阅读工具')}>
            {onNewMarkdown && <button className="icon-button" onClick={() => { closeMoreMenu(); onNewMarkdown() }} title={t('新建 Markdown')} aria-label={t('新建 Markdown')}><Plus size={17} /><span className="topbar-more-label">{t('新建 Markdown')}</span></button>}
            {markdownMode === 'edit' && onSaveMarkdownAs && <button className="icon-button" onClick={() => { closeMoreMenu(); onSaveMarkdownAs() }} title={t('另存为 Markdown')} aria-label={t('另存为 Markdown')}><Save size={17} /><span className="topbar-more-label">{t('另存为 Markdown')}</span></button>}
            {markdownMode === 'edit' && <>
              <button className="icon-button" onClick={() => { closeMoreMenu(); onUndoMarkdown?.() }} disabled={!markdownCanUndo} title={t('撤销')} aria-label={t('撤销')}><Undo2 size={17} /><span className="topbar-more-label">{t('撤销')}</span></button>
              <button className="icon-button" onClick={() => { closeMoreMenu(); onRedoMarkdown?.() }} disabled={!markdownCanRedo} title={t('重做')} aria-label={t('重做')}><Redo2 size={17} /><span className="topbar-more-label">{t('重做')}</span></button>
            </>}
            {pagedControls && <>
              <button className="icon-button" onClick={() => { closeMoreMenu(); pagedControls.onRotate() }} title={t('旋转页面')} aria-label={t('旋转页面')}><RotateCw size={17} /><span className="topbar-more-label">{t('旋转页面')}</span></button>
            </>}
            {canExportPdf && <button className="icon-button" onClick={() => { closeMoreMenu(); onExportPdf() }} disabled={exportingPdf} title={t(exportingPdf ? '正在导出 PDF…' : '导出 PDF')} aria-label={t(exportingPdf ? '正在导出 PDF…' : '导出 PDF')}><FileDown size={17} /><span className="topbar-more-label">{t(exportingPdf ? '正在导出 PDF…' : '导出 PDF')}</span></button>}
            {canToggleNavigation && <button className={'icon-button' + (tocOpen ? ' is-active' : '')} onClick={() => { closeMoreMenu(); onToggleToc() }} title={navigationLabel} aria-label={navigationLabel}><ListTree size={17} /><span className="topbar-more-label">{navigationLabel}</span></button>}
          </div>
        </details>
      </div>
    </header>
  )
}

type PagedToolbarProps = NonNullable<AppHeaderProps['pagedControls']> & { compactForMac: boolean }

function PagedToolbar({ documentType, page, pageCount, scale, minScale, maxScale, onPageChange, onZoomIn, onZoomOut, onRotate, onResetZoom, compactForMac }: PagedToolbarProps) {
  const t = useI18n()
  const [draftPage, setDraftPage] = useState(String(page))
  useEffect(() => setDraftPage(String(page)), [page])
  const commitPage = () => {
    const parsed = Number(draftPage)
    if (Number.isFinite(parsed) && pageCount > 0) onPageChange(Math.max(1, Math.min(pageCount, Math.floor(parsed))))
    else setDraftPage(String(page))
  }
  return <div className="paged-topbar-controls" role="group" aria-label={t(documentType === 'pdf' ? 'PDF 阅读控制' : 'OFD 阅读控制')}>
    <button type="button" className="icon-button compact" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} aria-label={t('上一页')} title={t('上一页')}><ChevronLeft size={15} /></button>
    <label className="ofd-page-control"><span className="sr-only">{t('页码')}</span><input
      type="number" min={1} max={pageCount || undefined} value={draftPage} aria-label={t('页码')}
      onChange={event => setDraftPage(event.target.value)}
      onBlur={commitPage}
      onKeyDown={event => { if (event.key === 'Enter') { commitPage(); event.currentTarget.blur() } }}
    /><span>/ {pageCount || '—'}</span></label>
    <button type="button" className="icon-button compact" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={!pageCount || page >= pageCount} aria-label={t('下一页')} title={t('下一页')}><ChevronRight size={15} /></button>
    <span className="ofd-toolbar-divider" aria-hidden="true" />
    <button type="button" className="icon-button compact" onClick={onZoomOut} disabled={scale <= minScale} aria-label={t(documentType === 'pdf' ? '缩小 PDF' : '缩小 OFD')} title={t(documentType === 'pdf' ? '缩小 PDF' : '缩小 OFD')}><ZoomOut size={15} /></button>
    <button type="button" className="paged-scale-label" onClick={onResetZoom} aria-label={t('重置页面倍率（⌘0 / Ctrl+0）')} title={t('重置页面倍率（⌘0 / Ctrl+0）')}>{Math.round(scale * 100)}%</button>
    <button type="button" className="icon-button compact" onClick={onZoomIn} disabled={scale >= maxScale} aria-label={t(documentType === 'pdf' ? '放大 PDF' : '放大 OFD')} title={t(documentType === 'pdf' ? '放大 PDF' : '放大 OFD')}><ZoomIn size={15} /></button>
    {!compactForMac && <>
      <button type="button" className="icon-button compact paged-rotate-button" onClick={onRotate} aria-label={t('旋转页面')} title={t('旋转页面')}><RotateCw size={15} /></button>
    </>}
  </div>
}
