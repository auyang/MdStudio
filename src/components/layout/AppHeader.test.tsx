// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../features/i18n'
import { AppHeader } from './AppHeader'

const tauriEnv = vi.hoisted(() => ({ isTauri: vi.fn(() => false) }))
const tauriWindow = vi.hoisted(() => ({ setTitle: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: tauriEnv.isTauri }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => tauriWindow }))

let host: HTMLDivElement
let root: Root
let userAgentDescriptor: PropertyDescriptor | undefined

function renderHeader(capabilities = { search: true, navigation: true }) {
  const controls = {
    documentType: 'pdf' as const,
    page: 1,
    pageCount: 4,
    scale: 1.25,
    onPageChange: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onRotate: vi.fn(),
    onResetZoom: vi.fn(),
  }
  const onToggleSearch = vi.fn()
  const onToggleToc = vi.fn()
  return { controls, onToggleSearch, onToggleToc, ...render(<I18nProvider locale="zh-CN"><AppHeader
    logo={null}
    tabs={[{ id: 'pdf-tab', canonicalPath: '/docs/one.pdf', displayName: 'one.pdf', status: 'ready', stale: false, documentType: 'pdf' }]}
    activeTabId="pdf-tab"
    activeDocumentType="pdf"
    canToggleNavigation={capabilities.navigation}
    canSearch={capabilities.search}
    navigationLabel="页面导航"
    loading={false}
    searchOpen={false}
    searchQuery=""
    searchIndex={0}
    searchCount={0}
    searchPending={false}
    tocOpen={false}
    doubleClickToClose={false}
    searchInputRef={{ current: null }}
    searchToggleRef={{ current: null }}
    canGoBack={false}
    canGoForward={false}
    navigationBusy={false}
    canExportPdf={false}
    exportingPdf={false}
    pagedControls={controls}
    onGoBack={vi.fn()}
    onGoForward={vi.fn()}
    onExportPdf={vi.fn()}
    onRefresh={vi.fn()}
    onToggleSearch={onToggleSearch}
    onToggleToc={onToggleToc}
    onOpenFile={vi.fn()}
    onSearchQueryChange={vi.fn()}
    onSearchPrevious={vi.fn()}
    onSearchNext={vi.fn()}
    onSearchClear={vi.fn()}
    onSearchKeyDown={vi.fn()}
    onCloseSearch={vi.fn()}
    onActivateTab={vi.fn()}
    onCloseTab={vi.fn()}
  /></I18nProvider>), controls, onToggleSearch, onToggleToc }
}

function render(element: React.ReactNode) {
  act(() => root.render(element))
  return { host }
}

describe('统一文档顶栏', () => {
  beforeEach(() => {
    tauriEnv.isTauri.mockReturnValue(false)
    tauriWindow.setTitle.mockClear()
    userAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    if (userAgentDescriptor) Object.defineProperty(navigator, 'userAgent', userAgentDescriptor)
  })

  it('PDF 页码和缩放只由共用单行顶栏提供，并按能力显示搜索与导航', () => {
    const result = renderHeader()
    expect(host.querySelectorAll('.paged-topbar-controls')).toHaveLength(1)
    expect(host.querySelector('.pdf-toolbar')).toBeNull()
    expect(host.querySelector('.ofd-topbar-controls')).toBeNull()
    expect(host.querySelector('[aria-label="页面导航"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="搜索本文"]')).not.toBeNull()

    const input = host.querySelector<HTMLInputElement>('.ofd-page-control input')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '3')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(result.controls.onPageChange).toHaveBeenCalledWith(3)
  })

  it('隐藏格式不具备的搜索与导航按钮', () => {
    renderHeader({ search: false, navigation: false })
    expect(host.querySelector('[aria-label="搜索本文"]')).toBeNull()
    expect(host.querySelector('[aria-label="页面导航"]')).toBeNull()
  })

  it('阅读宽度统一承接页面适配，页码工具栏只保留旋转控件', () => {
    renderHeader()
    const header = host.querySelector<HTMLElement>('.reader-topbar')!
    expect(header.classList.contains('is-macos')).toBe(false)
    expect(header.hasAttribute('data-tauri-drag-region')).toBe(false)
    expect(host.querySelector('.paged-topbar-controls .paged-fit-button')).toBeNull()
    expect(host.querySelector('.paged-topbar-controls .paged-rotate-button')).not.toBeNull()
  })

  it('macOS 顶栏提供原生拖动区域与紧凑工具菜单', () => {
    tauriEnv.isTauri.mockReturnValue(true)
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15',
    })
    const result = renderHeader()
    const header = host.querySelector<HTMLElement>('.reader-topbar')!
    expect(header.classList.contains('is-macos')).toBe(true)
    expect(header.getAttribute('data-tauri-drag-region')).toBe('deep')
    expect(host.querySelector('.brand-area')?.hasAttribute('data-tauri-drag-region')).toBe(true)
    expect(host.querySelector('.reader-tabs-scroll')?.hasAttribute('data-tauri-drag-region')).toBe(true)
    expect(host.querySelectorAll('.reader-topbar')).toHaveLength(1)

    expect(host.querySelector('.reader-tab')?.tagName).toBe('BUTTON')

    act(() => host.querySelector<HTMLElement>('.topbar-more-trigger')!.click())
    expect(host.querySelector('.topbar-more-panel button[aria-label="适合宽度"]')).toBeNull()
    expect(host.querySelector('.topbar-more-panel button[aria-label="整页"]')).toBeNull()
    for (const [label, handler] of [['旋转页面', result.controls.onRotate]] as const) {
      act(() => host.querySelector<HTMLButtonElement>(`.topbar-more-panel button[aria-label="${label}"]`)!.click())
      expect(handler).toHaveBeenCalledTimes(1)
      act(() => host.querySelector<HTMLElement>('.topbar-more-trigger')!.click())
    }
  })

  it('macOS 不通过重复设置原生窗口标题触发标题栏控件错位', async () => {
    tauriEnv.isTauri.mockReturnValue(true)
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15',
    })
    const originalTitle = document.title
    renderHeader()
    const settle = () => new Promise(resolve => window.setTimeout(resolve, 150))

    await act(async () => {
      document.title = '阅读样本 — MdStudio'
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('resize'))
      await settle()
    })
    expect(tauriWindow.setTitle).not.toHaveBeenCalled()
    document.title = originalTitle
  })
})
