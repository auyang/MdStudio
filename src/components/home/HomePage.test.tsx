// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../features/i18n'
import { HomePage } from './HomePage'
import { RecentFilesTable } from './RecentFilesTable'
import { SidebarNavigation } from './SidebarNavigation'

let host: HTMLDivElement
let root: Root

function render(element: React.ReactNode) {
  act(() => root.render(element))
}

describe('首页与主导航', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('最近文件使用持久化路径和时间，已打开文档才显示已知大小', () => {
    const onOpen = vi.fn()
    const onRemove = vi.fn()
    const openedAt = Date.UTC(2026, 10, 4, 12)
    render(<I18nProvider locale="zh-CN"><RecentFilesTable
      files={[
        { path: '/Users/test/项目说明.pdf', documentType: 'pdf', openedAt, byteSize: 2048 },
        { path: '/Users/test/手册.md', openedAt },
      ]}
      locale="zh-CN"
      onOpen={onOpen}
      onRemove={onRemove}
    /></I18nProvider>)

    expect(host.textContent).toContain('项目说明.pdf')
    expect(host.querySelector('[title="/Users/test/项目说明.pdf"]')).not.toBeNull()
    expect(host.textContent).toContain('2 KB')
    expect(host.textContent).toContain('MD')
    expect(host.querySelectorAll('time[datetime]')).toHaveLength(2)

    act(() => host.querySelector<HTMLButtonElement>('.recent-document-open')?.click())
    expect(onOpen).toHaveBeenCalledWith('/Users/test/项目说明.pdf')
    act(() => host.querySelector<HTMLButtonElement>('.recent-more-menu button')?.click())
    expect(onRemove).toHaveBeenCalledWith('/Users/test/项目说明.pdf')
  })

  it('空最近列表明确显示空状态，不生成示例项目', () => {
    render(<I18nProvider locale="en"><RecentFilesTable files={[]} locale="en" onOpen={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)
    expect(host.textContent).toContain('No recently opened files.')
    expect(host.querySelectorAll('.recent-table-row')).toHaveLength(0)
  })

  it('首页只提供打开文档和打开工作区，不重复放置新建 Markdown 按钮', () => {
    render(<I18nProvider locale="zh-CN"><HomePage
      logo={<span>MdStudio</span>}
      recents={[]}
      locale="zh-CN"
      onOpen={vi.fn()}
      onOpenWorkspace={vi.fn()}
      onOpenRecent={vi.fn()}
      onRemoveRecent={vi.fn()}
      onShowAllRecents={vi.fn()}
    /></I18nProvider>)

    const actionLabels = [...host.querySelectorAll<HTMLButtonElement>('.home-actions button')].map(button => button.textContent)
    expect(actionLabels).toEqual(['打开文档', '打开工作区'])
    expect(host.textContent).not.toContain('新建 Markdown')
  })

  it('导航切换和侧栏折叠均通过真实回调处理', () => {
    const onNavigate = vi.fn()
    const onToggleExpanded = vi.fn()
    render(<I18nProvider locale="zh-CN"><SidebarNavigation
      active="home"
      expanded
      width={230}
      workspaceAvailable={false}
      onNavigate={onNavigate}
      onOpenSettings={vi.fn()}
      onChooseWorkspace={vi.fn()}
      onToggleExpanded={onToggleExpanded}
      onWidthChange={vi.fn()}
    /></I18nProvider>)

    act(() => host.querySelector<HTMLButtonElement>('.app-sidebar-nav-item[title="最近"]')?.click())
    expect(onNavigate).toHaveBeenCalledWith('recent')
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="收起侧边栏"]')?.click())
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })
})
