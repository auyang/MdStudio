// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import { App } from './App'
import { READER_STORAGE_KEYS } from '../features/reader/preferences'

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  listen: vi.fn(),
  onDragDropEvent: vi.fn(),
}))
const mermaidModuleState = vi.hoisted(() => ({ loaded: false }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke, isTauri: tauri.isTauri }))
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }))
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: tauri.onDragDropEvent }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../components/reader/MermaidDiagram', async () => {
  const { createElement } = await import('react')
  mermaidModuleState.loaded = true
  return {
    MermaidDiagram: ({ source, language, theme }: { source: string; language: string; theme: string }) => createElement(
      'div',
      { className: 'mermaid-test-stub', 'data-language': language, 'data-theme': theme },
      source,
    ),
  }
})

const sampleDocument = {
  filePath: '/tmp/阅读样本.md',
  fileName: '阅读样本.md',
  html: '<h1 id="mdstudio-读我">读我</h1><p>这是一份只读文档。</p><pre><code class="language-rust">fn main() {}</code></pre>',
  headings: [{ id: 'mdstudio-读我', text: '读我', level: 1 }],
  mermaidDiagrams: [],
  missingResources: [],
  byteSize: 404,
  modifiedUnixMs: null,
}
function documentFor(path: string, body = '只读内容') {
  const name = path.split(/[\\/]/).at(-1) || '文档.md'
  return {
    ...sampleDocument,
    filePath: path,
    fileName: name,
    html: `<h1 id="mdstudio-${name}">${name}</h1><p>${body}</p>`,
    headings: [{ id: `mdstudio-${name}`, text: name, level: 1 }],
  }
}
const tinyImageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9pYAAAAASUVORK5CYII='
const sampleImageDocument = {
  ...sampleDocument,
  imageToken: 'reader-test-token',
  imageAssets: [{ index: 0, size: 128, width: 320, height: 180 }],
  html: '<h1 id="mdstudio-图片">图片查看</h1><p><img src="mdstudio-image://asset/0" alt="测试图片"></p>',
}

let host: HTMLDivElement
let root: Root

async function renderApp() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<App />)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('MdStudio Reader UI', () => {
  beforeEach(() => {
    localStorage.clear()
    tauri.invoke.mockReset()
    tauri.isTauri.mockReset()
    tauri.listen.mockReset()
    tauri.onDragDropEvent.mockReset()
    vi.mocked(open).mockReset()
    tauri.listen.mockResolvedValue(vi.fn())
    tauri.onDragDropEvent.mockResolvedValue(vi.fn())
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
    Object.defineProperty(window, 'scrollBy', { configurable: true, value: vi.fn() })
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    Element.prototype.scrollIntoView = vi.fn()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    host?.remove()
    vi.restoreAllMocks()
  })

  it('shows the minimal read-only home when no document is open', async () => {
    tauri.isTauri.mockReturnValue(false)
    await renderApp()

    expect(host.textContent).toContain('打开即读，简单纯粹。')
    expect(host.textContent).toContain('支持 .md 和 .markdown')
    expect(host.textContent).toContain('只读')
    expect(host.querySelector('.reader-article')).toBeNull()
    expect(host.querySelector('.welcome-panel .brand-logo')?.getAttribute('alt')).toBe('MdStudio')
  })

  it('renders the loaded document with TOC, search and code-copy controls', async () => {
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return ['/tmp/阅读样本.md']
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return sampleDocument
      return null
    })
    await renderApp()

    expect(host.querySelector('.reader-topbar .reader-tab[aria-selected="true"]')?.textContent).toContain('阅读样本.md')
    expect(host.querySelector('.reader-topbar')?.querySelector('.reader-tabs')).not.toBeNull()
    expect(host.querySelectorAll('.reader-tabs')).toHaveLength(1)
    expect(host.querySelector('.document-title')).toBeNull()
    expect(host.querySelector('.footer-left')?.textContent).toContain('404 B')
    expect(host.querySelector('.reader-article h1')?.textContent).toBe('读我')
    expect(host.querySelector('[data-copy-code]')).not.toBeNull()
    expect(mermaidModuleState.loaded).toBe(false)

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="文档目录"]')?.click())
    expect(host.querySelector('.toc-item')?.textContent).toBe('读我')

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="搜索本文"]')?.click())
    expect(host.querySelector('input[aria-label="搜索本文"]')).not.toBeNull()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(host.querySelector('input[aria-label="搜索本文"]')).toBeNull()
  })

  it('实时搜索跨格式文本，支持键盘循环与无结果状态且不改写正文 DOM', async () => {
    const searchable = {
      ...sampleDocument,
      html: '<h1 id="mdstudio-search">搜索样本</h1><p>你好<strong>世界</strong>；alpha ALPHA alpha</p><table><tbody><tr><td>中文表格</td></tr></tbody></table><pre><code><span>Search</span><span>Term</span>();</code><button>复制</button></pre>',
      headings: [{ id: 'mdstudio-search', text: '搜索样本', level: 1 }],
    }
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === 'take_pending_open_files') return ['/tmp/search.md']
      if (command === 'normalize_reader_path') return '/tmp/search.md'
      if (command === 'load_reader_document') return searchable
      return null
    })
    await renderApp()
    const originalHtml = host.querySelector('.reader-article')!.innerHTML
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true })))
    await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    const input = () => host.querySelector<HTMLInputElement>('.search-box input')!
    expect(input()).not.toBeNull()
    expect(document.activeElement).toBe(input())
    expect(host.querySelector('.search-box')?.closest('.reader-topbar')).not.toBeNull()
    expect(host.querySelectorAll('.reader-topbar > .search-toolbar-row')).toHaveLength(0)

    const setQuery = async (query: string) => act(async () => {
      const field = input()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(field, query)
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 180))
    })
    await setQuery('你好世界')
    expect(host.querySelector('.search-count')?.textContent).toBe('1 / 1')
    await setQuery('alpha')
    expect(host.querySelector('.search-count')?.textContent).toBe('1 / 3')
    await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(host.querySelector('.search-count')?.textContent).toBe('2 / 3')
    expect(host.querySelector<HTMLButtonElement>('[aria-label="后退"]')?.disabled).toBe(true)
    await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })))
    expect(host.querySelector('.search-count')?.textContent).toBe('1 / 3')
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', metaKey: true, bubbles: true, cancelable: true })))
    expect(host.querySelector('.search-count')?.textContent).toBe('2 / 3')
    await setQuery('不存在的内容')
    expect(host.querySelector('.search-count')?.textContent).toBe('0 / 0')
    expect(host.querySelector('.search-empty')?.textContent).toBe('无结果')
    expect(host.querySelector('.reader-article')!.innerHTML).toBe(originalHtml)
    expect(host.querySelector('.reader-article mark')).toBeNull()
    await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(host.querySelector('.search-box')).toBeNull()
    expect(host.querySelector('.reader-article')!.innerHTML).toBe(originalHtml)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="文档目录"]')?.click())
    expect(host.querySelector('[aria-current="location"]')?.textContent).toBe('搜索样本')
  })

  it('同文档标题锚点仅页内跳转，不创建新标签或重新加载', async () => {
    const anchoredDocument = {
      ...sampleDocument,
      html: '<h1 id="mdstudio-section">章节</h1><p><a href="#section">跳到章节</a></p>',
      headings: [{ id: 'mdstudio-section', text: '章节', level: 1 }],
    }
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return ['/tmp/anchor.md']
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return anchoredDocument
      return null
    })
    await renderApp()

    const link = host.querySelector<HTMLAnchorElement>('a[href="#section"]')!
    await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(tauri.invoke.mock.calls.filter(([command]) => command === 'load_reader_document')).toHaveLength(1)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('相对 Markdown 链接进入目标章节后可后退到原文阅读位置并前进', async () => {
    const overviewPath = '/tmp/navigation-overview.md'
    const detailPath = '/tmp/navigation-detail.md'
    const overview = {
      ...documentFor(overviewPath),
      html: '<h1 id="mdstudio-overview">概览</h1><p><a href="mdstudio-document://open?path=%2Ftmp%2Fnavigation-detail.md#接口说明">接口说明</a></p><h2 id="mdstudio-example">示例章节</h2><p>阅读起点</p>',
      headings: [
        { id: 'mdstudio-overview', text: '概览', level: 1 },
        { id: 'mdstudio-example', text: '示例章节', level: 2 },
      ],
    }
    const detail = {
      ...documentFor(detailPath),
      html: '<h1 id="mdstudio-detail">详细文档</h1><h2 id="mdstudio-接口说明">接口说明</h2><p>接口内容</p>',
      headings: [
        { id: 'mdstudio-detail', text: '详细文档', level: 1 },
        { id: 'mdstudio-接口说明', text: '接口说明', level: 2 },
      ],
    }
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return [overviewPath]
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return args?.filePath === detailPath ? detail : overview
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 321 })

    await act(async () => {
      host.querySelector<HTMLAnchorElement>('a[href^="mdstudio-document:"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 80))
    })
    expect(host.querySelector('.reader-tab[aria-selected="true"]')?.textContent).toContain('navigation-detail.md')
    expect(host.querySelector<HTMLButtonElement>('[aria-label="后退"]')?.disabled).toBe(false)
    expect(host.querySelector('#mdstudio-接口说明')?.textContent).toBe('接口说明')

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="后退"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    expect(host.querySelector('.reader-tab[aria-selected="true"]')?.textContent).toContain('navigation-overview.md')
    expect(vi.mocked(window.scrollTo)).toHaveBeenCalledWith(expect.objectContaining({ top: 321 }))

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭 navigation-detail.md"]')!.click())
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1)

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="前进"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 80))
    })
    expect(host.querySelector('.reader-tab[aria-selected="true"]')?.textContent).toContain('navigation-detail.md')

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="搜索本文"]')!.click())
    const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索本文"]')!
    await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', { key: '[', metaKey: true, bubbles: true, cancelable: true })))
    expect(host.querySelector('.reader-tab[aria-selected="true"]')?.textContent).toContain('navigation-detail.md')
    await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(host.querySelector('input[aria-label="搜索本文"]')).toBeNull()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', metaKey: true, bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    expect(host.querySelector('.reader-tab[aria-selected="true"]')?.textContent).toContain('navigation-overview.md')
  })

  it('历史目标文件被删除时显示可读错误并保持导航可重试', async () => {
    const overviewPath = '/tmp/navigation-recovery-overview.md'
    const detailPath = '/tmp/navigation-recovery-detail.md'
    let deleted = false
    let changeHandler: ((event: { payload: { paths: string[]; operation: string } }) => void) | undefined
    const overview = {
      ...documentFor(overviewPath),
      html: '<h1 id="mdstudio-overview">概览</h1><p><a href="mdstudio-document://open?path=%2Ftmp%2Fnavigation-recovery-detail.md#detail">详细内容</a></p>',
      headings: [{ id: 'mdstudio-overview', text: '概览', level: 1 }],
    }
    const detail = {
      ...documentFor(detailPath),
      html: '<h1 id="mdstudio-detail">详细内容</h1>',
      headings: [{ id: 'mdstudio-detail', text: '详细内容', level: 1 }],
    }
    tauri.isTauri.mockReturnValue(true)
    tauri.listen.mockImplementation((event, handler) => {
      if (event === 'mdstudio:file-change') {
        changeHandler = handler as (event: { payload: { paths: string[]; operation: string } }) => void
      }
      return Promise.resolve(vi.fn())
    })
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return [overviewPath]
      if (command === 'normalize_reader_path') {
        if (deleted && args?.filePath === detailPath) throw new Error('目标 Markdown 文件已不存在。')
        return args?.filePath
      }
      if (command === 'load_reader_document') return args?.filePath === detailPath ? detail : overview
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

    await act(async () => {
      host.querySelector<HTMLAnchorElement>('a[href^="mdstudio-document:"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 60))
    })
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="后退"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 40))
    })
    deleted = true
    await act(async () => changeHandler?.({ payload: { paths: [detailPath], operation: 'removed' } }))

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="前进"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 300))
    })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('目标 Markdown 文件已不存在')
    expect(host.querySelector('[role="alert"] button')?.textContent).toBe('重试')
    expect(host.querySelector('.reader-shell')).not.toBeNull()
    expect(host.querySelector('.reader-article')?.textContent).toContain('详细内容')
    expect(host.querySelector<HTMLButtonElement>('[aria-label="前进"]')?.disabled).toBe(true)
    expect(host.querySelector<HTMLButtonElement>('[aria-label="后退"]')?.disabled).toBe(false)
  })

  it('cycles the reader theme without adding an editor surface', async () => {
    tauri.isTauri.mockReturnValue(false)
    await renderApp()

    const theme = host.querySelector<HTMLButtonElement>('.theme-button')!
    await act(async () => theme.click())
    expect(document.documentElement.dataset.theme).toBe('light')
    await act(async () => theme.click())
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(host.querySelector('.milkdown, .cm-editor, .ai-panel, .diff-viewer')).toBeNull()
  })

  it('跟随系统主题时响应操作系统外观变化', async () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      })),
    })
    tauri.isTauri.mockReturnValue(false)
    await renderApp()

    expect(document.documentElement.dataset.theme).toBe('light')
    await act(async () => listeners.forEach(listener => listener({ matches: true } as MediaQueryListEvent)))
    expect(document.documentElement.dataset.theme).toBe('dark')
    await act(async () => listeners.forEach(listener => listener({ matches: false } as MediaQueryListEvent)))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('设置快捷键打开设置中心，主题、字号和宽度立即应用并持久化', async () => {
    tauri.isTauri.mockReturnValue(false)
    await renderApp()

    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true })))
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="阅读主题"] button:nth-child(3)')?.click())
    await act(async () => {
      const font = host.querySelector<HTMLInputElement>('#reader-font-size')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(font, '20')
      font.dispatchEvent(new Event('input', { bubbles: true }))
      font.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const widths = host.querySelectorAll<HTMLButtonElement>('[aria-label="阅读宽度"] button')
    for (const [index, expected] of ['720px', '820px', '980px'].entries()) {
      await act(async () => widths[index].click())
      expect(document.documentElement.style.getPropertyValue('--reader-width')).toBe(expected)
    }

    const saved = JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.settings) || '{}')
    expect(saved).toMatchObject({ theme: 'dark', fontSizePx: 20, readingWidth: 'wide' })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--reader-font-size')).toBe('20px')
    expect(document.documentElement.style.getPropertyValue('--reader-width')).toBe('980px')
  })

  it('保留已有阅读宽度，并让状态栏与设置中心即时共享同一偏好', async () => {
    const path = '/tmp/width-sync.md'
    localStorage.setItem(READER_STORAGE_KEYS.settings, JSON.stringify({
      schemaVersion: 1, theme: 'system', fontSizePx: 16, readingWidth: 'standard', restoreTabs: true, rememberPosition: true,
    }))
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return [path]
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return documentFor(path)
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })

    const loadsBeforeWidthChange = tauri.invoke.mock.calls.filter(([command]) => command === 'load_reader_document').length
    expect(document.documentElement.style.getPropertyValue('--reader-width')).toBe('820px')
    expect(host.querySelector('.reader-width-picker summary')?.textContent).toContain('标准')
    expect(host.querySelector('.reader-article h1')?.textContent).toContain('width-sync.md')

    await act(async () => {
      host.querySelector<HTMLDetailsElement>('.reader-width-picker')!.open = true
      Array.from(host.querySelectorAll<HTMLButtonElement>('.reader-width-menu button')).find(button => button.textContent?.includes('宽屏'))?.click()
    })
    expect(document.documentElement.style.getPropertyValue('--reader-width')).toBe('980px')
    expect(host.querySelector('.reader-width-picker summary')?.textContent).toContain('宽屏')
    expect(tauri.invoke.mock.calls.filter(([command]) => command === 'load_reader_document')).toHaveLength(loadsBeforeWidthChange)

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="打开设置"]')?.click())
    const wideChoice = Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="阅读宽度"] button')).find(button => button.textContent?.includes('980px'))
    expect(wideChoice?.getAttribute('aria-pressed')).toBe('true')
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="阅读宽度"] button')).find(button => button.textContent?.includes('720px'))?.click())
    expect(document.documentElement.style.getPropertyValue('--reader-width')).toBe('720px')
    expect(host.querySelector('.reader-width-picker summary')?.textContent).toContain('紧凑')
    expect(JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.settings) || '{}').readingWidth).toBe('compact')
    expect(host.querySelector('.reader-article h1')?.textContent).toContain('width-sync.md')
  })

  it('状态栏设置写入失败时明确提示只在本次运行中生效', async () => {
    tauri.isTauri.mockReturnValue(false)
    await renderApp()
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (key === READER_STORAGE_KEYS.settings) throw new Error('quota exceeded')
      originalSetItem.call(localStorage, key, value)
    })

    await act(async () => {
      host.querySelector<HTMLDetailsElement>('.reader-width-picker')!.open = true
      Array.from(host.querySelectorAll<HTMLButtonElement>('.reader-width-menu button')).find(button => button.textContent?.includes('紧凑'))?.click()
    })
    expect(host.querySelector('.reader-toast.is-warning[role="alert"]')?.textContent).toContain('当前更改仅在本次运行中生效')
    expect(host.querySelector('.reader-width-picker summary')?.textContent).toContain('紧凑')
    expect(JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.settings) || '{}').readingWidth).toBe('wide')
  })

  it('系统菜单的关于入口打开设置中的关于页', async () => {
    let aboutHandler: ((event: { payload: unknown }) => void) | undefined
    tauri.isTauri.mockReturnValue(true)
    tauri.listen.mockImplementation((event, handler) => {
      if (event === 'mdstudio:show-settings-about') {
        aboutHandler = handler as (event: { payload: unknown }) => void
      }
      return Promise.resolve(vi.fn())
    })
    tauri.invoke.mockImplementation(async command => command === 'take_pending_open_files' ? [] : null)
    await renderApp()

    await act(async () => {
      aboutHandler?.({ payload: undefined })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.querySelector('#settings-tab-about')?.getAttribute('aria-selected')).toBe('true')
    expect(host.textContent).toContain('Just Read Markdown.')

    await act(async () => host.querySelector<HTMLButtonElement>('#settings-tab-history')?.click())
    await act(async () => {
      aboutHandler?.({ payload: undefined })
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(host.querySelector('#settings-tab-about')?.getAttribute('aria-selected')).toBe('true')
  })

  it('关闭标签恢复后若无法清除会话元数据，会在设置中提示', async () => {
    tauri.isTauri.mockReturnValue(false)
    await renderApp()
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(key => {
      if (key === READER_STORAGE_KEYS.session) throw new Error('storage unavailable')
    })

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="打开设置"]')?.click())
    await act(async () => host.querySelector<HTMLButtonElement>('#settings-tab-history')?.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="恢复上次打开的标签"]')?.click())

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('恢复会话无法清除')
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3)
  })

  it('启动时按顺序恢复上次标签和活动文档，显式启动文件优先且仅计入最近文件', async () => {
    const previousPaths = ['/tmp/restore-a.md', '/tmp/restore-b.markdown']
    const explicitPath = '/tmp/explicit.md'
    localStorage.setItem(READER_STORAGE_KEYS.session, JSON.stringify({
      schemaVersion: 1,
      tabPaths: previousPaths,
      activePath: previousPaths[0],
      updatedAt: 50,
    }))
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return [explicitPath]
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return documentFor(args?.filePath || '')
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })

    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs.map(tab => tab.title)).toEqual([...previousPaths, explicitPath])
    expect(tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.title).toBe(explicitPath)
    expect(host.querySelector('.reader-article')?.textContent).toContain('explicit.md')
    const recent = JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.recents) || '{"files":[]}')
    expect(recent.files.map((item: { path: string }) => item.path)).toEqual([explicitPath])
  })

  it('十五个标签保持单行、活动标签自动滚入可见区域，且新增按钮继续打开文件选择器', async () => {
    const paths = Array.from({ length: 15 }, (_, index) => `/tmp/文档-${index + 1}.md`)
    localStorage.setItem(READER_STORAGE_KEYS.session, JSON.stringify({
      schemaVersion: 1, tabPaths: paths, activePath: paths.at(-1), updatedAt: 50,
    }))
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return documentFor(args?.filePath || '')
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 45)) })

    const tabs = host.querySelectorAll<HTMLButtonElement>('.reader-topbar [role="tab"]')
    const scroll = host.querySelector<HTMLDivElement>('.reader-tabs-scroll')!
    expect(tabs).toHaveLength(15)
    expect(host.querySelectorAll('.reader-tabs')).toHaveLength(1)
    expect(host.querySelector('.reader-topbar .reader-tab[aria-selected="true"]')?.title).toBe(paths.at(-1))

    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 300 })
    Object.defineProperty(scroll, 'offsetLeft', { configurable: true, value: 100 })
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400 } as DOMRect)
    for (const [index, item] of Array.from(scroll.querySelectorAll<HTMLElement>('.reader-tab-item')).entries()) {
      Object.defineProperty(item, 'offsetLeft', { configurable: true, value: 100 + index * 140 })
      Object.defineProperty(item, 'offsetWidth', { configurable: true, value: 140 })
      vi.spyOn(item, 'getBoundingClientRect').mockImplementation(() => {
        const left = 100 + index * 140 - scroll.scrollLeft
        return { left, right: left + 140 } as DOMRect
      })
    }
    scroll.scrollLeft = 14 * 140
    await act(async () => tabs[0].click())
    expect(scroll.scrollLeft).toBe(0)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    await act(async () => tabs[14].click())
    expect(scroll.scrollLeft).toBe(13 * 140)
    const activeBounds = host.querySelector('.reader-tab-item.is-active')!.getBoundingClientRect()
    expect(activeBounds.left).toBeGreaterThanOrEqual(100)
    expect(activeBounds.right).toBeLessThanOrEqual(400)

    // 模拟浏览器将当前标签贴到右边后，左侧遗留前一个标签的一小段。
    scroll.scrollLeft = 14 * 140 - 160
    await act(async () => { window.dispatchEvent(new Event('resize')) })
    const firstVisibleTab = Array.from(scroll.querySelectorAll<HTMLElement>('.reader-tab-item'))
      .find(item => item.getBoundingClientRect().right > 101)!
    expect(firstVisibleTab.getBoundingClientRect().left).toBeGreaterThanOrEqual(99)
    expect(firstVisibleTab.getBoundingClientRect().right).toBeLessThanOrEqual(101 + 140)
    const resizedActiveBounds = host.querySelector('.reader-tab-item.is-active')!.getBoundingClientRect()
    expect(resizedActiveBounds.left).toBeGreaterThanOrEqual(100)
    expect(resizedActiveBounds.right).toBeLessThanOrEqual(400)

    vi.mocked(open).mockResolvedValue(['/tmp/新增.md'])
    await act(async () => {
      expect(host.querySelector('.reader-topbar .open-button')).toBeNull()
      expect(host.querySelector<HTMLButtonElement>('[aria-label="打开 Markdown 文件（Ctrl/Cmd+O）"]')).not.toBeNull()
      host.querySelector<HTMLButtonElement>('[aria-label="打开 Markdown 文件（Ctrl/Cmd+O）"]')?.click()
      await new Promise(resolve => setTimeout(resolve, 25))
    })
    expect(open).toHaveBeenCalledOnce()
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(16)
    expect(host.querySelector('.reader-topbar .reader-tab[aria-selected="true"]')?.title).toBe('/tmp/新增.md')
  })

  it('默认双击关闭目标标签，关闭开关后保留普通标签切换', async () => {
    const firstPath = '/tmp/double-click-first.md'
    const secondPath = '/tmp/double-click-second.md'
    localStorage.setItem(READER_STORAGE_KEYS.session, JSON.stringify({
      schemaVersion: 1, tabPaths: [firstPath, secondPath], activePath: firstPath, updatedAt: 50,
    }))
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return documentFor(args?.filePath || '')
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 45)) })

    const dispatchDoubleClick = async (path: string) => {
      const tab = host.querySelector<HTMLButtonElement>(`[role="tab"][title="${path}"]`)
      expect(tab).not.toBeNull()
      await act(async () => {
        tab!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        tab!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
        tab!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
        await new Promise(resolve => setTimeout(resolve, 0))
      })
    }
    const closeSettings = async () => act(async () => {
      host.querySelector<HTMLElement>('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })

    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(host.querySelector('.reader-tab[aria-selected="true"]')?.title).toBe(firstPath)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="打开设置"]')?.click())
    await act(async () => host.querySelector<HTMLButtonElement>('#settings-tab-history')?.click())
    const doubleClickSwitch = host.querySelector<HTMLButtonElement>('[aria-label="双击标签页关闭"]')!
    expect(doubleClickSwitch.getAttribute('aria-checked')).toBe('true')
    await act(async () => doubleClickSwitch.click())
    expect(JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.settings) || '{}').doubleClickToClose).toBe(false)
    await closeSettings()

    await dispatchDoubleClick(secondPath)
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(host.querySelector('.reader-tab[aria-selected="true"]')?.title).toBe(secondPath)

    vi.mocked(open).mockResolvedValue([])
    const addButton = host.querySelector<HTMLButtonElement>('.reader-tabs-add')!
    await act(async () => {
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
      addButton.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(vi.mocked(open)).toHaveBeenCalledOnce()
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)

    const closeSecond = host.querySelector<HTMLButtonElement>('[aria-label="关闭 double-click-second.md"]')!
    await act(async () => {
      closeSecond.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      closeSecond.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
      closeSecond.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
    })
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(host.querySelector('.reader-tab[aria-selected="true"]')?.title).toBe(firstPath)

    vi.mocked(open).mockReset().mockResolvedValue([secondPath])
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.reader-tabs-add')?.click()
      await new Promise(resolve => setTimeout(resolve, 45))
    })
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="打开设置"]')?.click())
    await act(async () => host.querySelector<HTMLButtonElement>('#settings-tab-history')?.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="双击标签页关闭"]')?.click())
    expect(JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.settings) || '{}').doubleClickToClose).toBe(true)
    await closeSettings()

    await act(async () => {
      host.querySelector<HTMLButtonElement>(`[role="tab"][title="${firstPath}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await new Promise(resolve => setTimeout(resolve, 250))
    })
    expect(host.querySelector('.reader-tab[aria-selected="true"]')?.title).toBe(firstPath)
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
    await dispatchDoubleClick(secondPath)
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(host.querySelector('.reader-tab[aria-selected="true"]')?.title).toBe(firstPath)
    expect(host.querySelector('.reader-article h1')?.textContent).toContain('double-click-first.md')

    await dispatchDoubleClick(firstPath)
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(host.querySelector('.welcome-panel')).not.toBeNull()
  })

  it('恢复历史中失效的路径会跳过，其余文档仍可恢复', async () => {
    const missing = '/tmp/missing.md'
    const available = '/tmp/available.md'
    localStorage.setItem(READER_STORAGE_KEYS.session, JSON.stringify({
      schemaVersion: 1, tabPaths: [missing, available], activePath: missing, updatedAt: 50,
    }))
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') {
        if (args?.filePath === missing) throw new Error('文件不存在')
        return documentFor(available)
      }
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })

    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(host.querySelector('[role="tab"]')?.title).toBe(available)
    expect(host.textContent).toContain('无法访问，已跳过')
  })

  it('关闭标签恢复时不恢复旧会话，并清除会话元数据', async () => {
    const path = '/tmp/should-not-restore.md'
    localStorage.setItem(READER_STORAGE_KEYS.settings, JSON.stringify({
      schemaVersion: 1, theme: 'system', fontSizePx: 16, readingWidth: 'standard', restoreTabs: false, rememberPosition: true,
    }))
    localStorage.setItem(READER_STORAGE_KEYS.session, JSON.stringify({ schemaVersion: 1, tabPaths: [path], activePath: path, updatedAt: 10 }))
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async command => command === 'take_pending_open_files' ? [] : null)
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(localStorage.getItem(READER_STORAGE_KEYS.session)).toBeNull()
  })

  it('保存成功打开的标签顺序和当前活动标签', async () => {
    const paths = ['/tmp/session-first.md', '/tmp/session-active.md']
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return documentFor(args?.filePath || '')
      return null
    })
    vi.mocked(open).mockResolvedValue(paths)
    await renderApp()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.open-button')?.click()
      await new Promise(resolve => setTimeout(resolve, 25))
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 330)) })
    const session = JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.session) || '{}')
    expect(session.tabPaths).toEqual(paths)
    expect(session.activePath).toBe(paths[1])
  })

  it('关闭阅读位置记忆后，重新打开文档从顶部开始', async () => {
    const path = '/tmp/position.md'
    localStorage.setItem(READER_STORAGE_KEYS.settings, JSON.stringify({
      schemaVersion: 1, theme: 'system', fontSizePx: 16, readingWidth: 'standard', restoreTabs: true, rememberPosition: false,
    }))
    localStorage.setItem(READER_STORAGE_KEYS.positions, JSON.stringify({
      schemaVersion: 1,
      items: { [path]: { path, headingId: 'mdstudio-saved', scrollRatio: 0.4, scrollTop: 560, updatedAt: 10 } },
    }))
    localStorage.setItem(READER_STORAGE_KEYS.session, JSON.stringify({ schemaVersion: 1, tabPaths: [path], activePath: path, updatedAt: 10 }))
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return {
        ...documentFor(path),
        html: '<h1 id="mdstudio-position.md">position.md</h1><h2 id="mdstudio-saved">Saved</h2>',
      }
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(vi.mocked(window.scrollTo)).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
  })

  it('恢复阅读位置时优先使用稳定标题锚点', async () => {
    const path = '/tmp/position.md'
    localStorage.setItem(READER_STORAGE_KEYS.positions, JSON.stringify({
      schemaVersion: 1,
      items: { [path]: { path, headingId: 'mdstudio-saved', scrollRatio: 0.4, scrollTop: 560, updatedAt: 10 } },
    }))
    localStorage.setItem(READER_STORAGE_KEYS.session, JSON.stringify({ schemaVersion: 1, tabPaths: [path], activePath: path, updatedAt: 10 }))
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return {
        ...documentFor(path),
        html: '<h1 id="mdstudio-position.md">position.md</h1><h2 id="mdstudio-saved">Saved</h2>',
      }
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(vi.mocked(window.scrollTo)).not.toHaveBeenCalledWith({ top: 560, behavior: 'instant' })
  })

  it('滚动时以防抖方式保存每篇文档的阅读位置元数据', async () => {
    const path = '/tmp/position-save.md'
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return [path]
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return documentFor(path)
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 321 })
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
      await new Promise(resolve => setTimeout(resolve, 500))
    })
    const saved = JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.positions) || '{}')
    expect(saved.items[path]).toMatchObject({ path, scrollTop: 321, headingId: 'mdstudio-position-save.md' })
  })

  it('maps Comrak AST Mermaid source into the lazy reader renderer', async () => {
    const source = 'graph TB\n    A[AST 源码] --> B[保留原文]\n'
    const diagramDocument = {
      ...sampleDocument,
      html: '<h1 id="mdstudio-mermaid">图表</h1><pre><code class="language-mermaid">HTML 展示文本</code></pre>',
      mermaidDiagrams: [{ index: 0, language: 'mermaid', source }],
    }
    mermaidModuleState.loaded = false
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return ['/tmp/mermaid.md']
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return diagramDocument
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })

    expect(mermaidModuleState.loaded).toBe(true)
    expect(host.querySelector('.reader-mermaid-host')).not.toBeNull()
    expect(host.querySelector('.mermaid-test-stub')?.textContent).toBe(source)
    expect(host.querySelector('.mermaid-test-stub')?.getAttribute('data-language')).toBe('mermaid')
  })

  it('切换 Mermaid 文档时延迟卸载旧图表 root，不产生 React 提交竞争', async () => {
    let openFileHandler: ((event: { payload: string }) => void) | undefined
    tauri.listen.mockImplementation((event, handler) => {
      if (event === 'mdstudio:open-file') openFileHandler = handler
      return Promise.resolve(vi.fn())
    })
    const firstDocument = {
      ...sampleDocument,
      filePath: '/tmp/mermaid-first.md',
      fileName: 'mermaid-first.md',
      html: '<pre><code class="language-mermaid">graph TB\n    A[第一张]</code></pre>',
      mermaidDiagrams: [{ index: 0, language: 'mermaid', source: 'graph TB\n    A[第一张]\n' }],
    }
    const secondDocument = {
      ...firstDocument,
      filePath: '/tmp/mermaid-second.md',
      fileName: 'mermaid-second.md',
      html: '<pre><code class="language-mermaid">graph TB\n    A[第二张]</code></pre>',
      mermaidDiagrams: [{ index: 0, language: 'mermaid', source: 'graph TB\n    A[第二张]\n' }],
    }
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return ['/tmp/mermaid-first.md']
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') {
        return args?.filePath === secondDocument.filePath ? secondDocument : firstDocument
      }
      return null
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
    expect(host.querySelector('.mermaid-test-stub')?.textContent).toContain('第一张')

    await act(async () => {
      openFileHandler?.({ payload: secondDocument.filePath })
      await new Promise(resolve => setTimeout(resolve, 25))
    })
    expect(host.querySelector('.reader-topbar .reader-tab[aria-selected="true"]')?.textContent).toContain('mermaid-second.md')
    expect(host.querySelector('.mermaid-test-stub')?.textContent).toContain('第二张')
    await act(async () => { await new Promise(resolve => queueMicrotask(resolve)) })
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      'Attempted to synchronously unmount a root while React was already rendering',
    )
  })

  it('正文图片按需读取，点击后打开统一查看器并可关闭、缩放和连续使用', async () => {
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return ['/tmp/图片.md']
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return sampleImageDocument
      if (command === 'load_reader_image') return tinyImageData
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })

    const image = host.querySelector<HTMLImageElement>('.reader-article img[data-reader-image="true"]')!
    expect(tauri.invoke).toHaveBeenCalledWith('load_reader_image', { imageToken: 'reader-test-token', index: 0 })
    expect(image.dataset.readerImageLoaded).toBe('true')
    expect(image.src).toBe(tinyImageData)

    const scrollTop = window.scrollY
    for (let index = 0; index < 30; index += 1) {
      await act(async () => image.click())
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
      const canvas = document.body.querySelector<HTMLElement>('.reader-mermaid-viewer-canvas')!
      canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
      const viewerImage = dialog.querySelector<HTMLImageElement>('.reader-mermaid-viewer-scene img')!
      Object.defineProperty(viewerImage, 'naturalWidth', { configurable: true, value: 320 })
      Object.defineProperty(viewerImage, 'naturalHeight', { configurable: true, value: 180 })
      await act(async () => viewerImage.dispatchEvent(new Event('load')))
      const readout = dialog.querySelector('[aria-label="当前缩放比例"]')!
      expect(readout.textContent).toBe('250%')
      if (index === 0) {
        const byText = (label: string) => Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === label)
        await act(async () => byText('100%')?.click())
        expect(readout.textContent).toBe('100%')
        await act(async () => byText('重置')?.click())
        expect(readout.textContent).toBe('250%')
      }
      await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="放大图片"]')?.click())
      expect(readout.textContent).toBe('300%')
      if (index === 0) {
        const wheel = new WheelEvent('wheel', { deltaY: 100, clientX: 240, clientY: 180, bubbles: true, cancelable: true })
        await act(async () => canvas.dispatchEvent(wheel))
        expect(wheel.defaultPrevented).toBe(true)
        expect(readout.textContent).toBe('268%')
        await act(async () => Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '适应窗口')?.click())
        expect(readout.textContent).toBe('250%')

        const scene = dialog.querySelector<HTMLElement>('.reader-mermaid-viewer-scene')!
        const beforeDrag = scene.style.transform
        const Pointer = window.PointerEvent ?? MouseEvent
        await act(async () => {
          canvas.dispatchEvent(new Pointer('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true }))
          canvas.dispatchEvent(new Pointer('pointermove', { button: 0, clientX: 140, clientY: 125, bubbles: true }))
          canvas.dispatchEvent(new Pointer('pointerup', { button: 0, clientX: 140, clientY: 125, bubbles: true }))
        })
        expect(scene.style.transform).not.toBe(beforeDrag)
      }
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 2)) })
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(image.closest('button[data-reader-image-viewer]'))
    }
    expect(window.scrollY).toBe(scrollTop)
    expect(document.body.querySelector('.reader-mermaid-viewer-backdrop')).toBeNull()
  })

  it('先解码脱离 DOM 的 eager 图片，避免 WebKit 对 hidden lazy 图片等待而卡住', async () => {
    const decode = vi.fn(function (this: HTMLImageElement) {
      if (this.isConnected && this.hidden && this.loading === 'lazy') {
        return new Promise<void>(() => undefined)
      }
      return Promise.resolve()
    })
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode })
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return ['/tmp/图片.md']
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return sampleImageDocument
      if (command === 'load_reader_image') return tinyImageData
      return null
    })

    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

    const image = host.querySelector<HTMLImageElement>('.reader-article img[data-reader-image="true"]')!
    expect(image.hidden).toBe(false)
    expect(image.loading).toBe('eager')
    expect(image.dataset.readerImageLoaded).toBe('true')
    expect(decode).toHaveBeenCalledTimes(1)
    expect(decode.mock.instances[0].isConnected).toBe(false)
  })

  it('链接内图片保留文档跳转，独立放大按钮不触发链接', async () => {
    const linkedDocument = {
      ...sampleImageDocument,
      html: '<p><a href="mdstudio-document://open?path=%2Ftmp%2Ftarget.md#mdstudio-目标"><img src="mdstudio-image://asset/0" alt="链接图片"></a></p>',
    }
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return ['/tmp/链接图.md']
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return args?.filePath === '/tmp/target.md' ? sampleDocument : linkedDocument
      if (command === 'load_reader_image') return tinyImageData
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })

    const zoom = host.querySelector<HTMLButtonElement>('[data-reader-image-viewer]')!
    await act(async () => zoom.click())
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect(tauri.invoke.mock.calls.filter(([command]) => command === 'load_reader_document')).toHaveLength(1)
    await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="关闭放大查看"]')?.click())

    const anchor = host.querySelector<HTMLAnchorElement>('.reader-image-frame a[href]')!
    const linkClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => anchor.querySelector('.reader-image-pending')?.dispatchEvent(linkClick))
    expect(linkClick.defaultPrevented).toBe(true)
    expect(tauri.invoke.mock.calls).toContainEqual(['load_reader_document', { filePath: '/tmp/target.md' }])
  })

  it('图片读取失败显示错误与重试入口，成功后恢复正文图片', async () => {
    let imageLoads = 0
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return ['/tmp/图片.md']
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return sampleImageDocument
      if (command === 'load_reader_image') {
        imageLoads += 1
        if (imageLoads === 1) throw new Error('图片文件内容无效')
        return tinyImageData
      }
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(host.querySelector('.reader-image-pending')?.textContent).toContain('图片文件内容无效')
    expect(host.querySelector('[data-reader-image-retry]')).not.toBeNull()

    await act(async () => host.querySelector<HTMLButtonElement>('[data-reader-image-retry]')?.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector<HTMLImageElement>('.reader-article img')?.dataset.readerImageLoaded).toBe('true')
    expect(host.querySelector('[data-reader-image-retry]')).toBeNull()
  })

  it('多选 5 份文档时批量建标签、路径去重并区分同名文档', async () => {
    const paths = ['/tmp/a/notes.md', '/tmp/b/notes.md', '/tmp/c/third.md', '/tmp/d/fourth.markdown', '/tmp/e/fifth.md', '/tmp/a/notes.md']
    const documents = new Map(paths.map(path => [path, documentFor(path, path)]))
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return documents.get(args?.filePath || '')
      return null
    })
    vi.mocked(open).mockResolvedValue(paths)
    await renderApp()

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.reader-tabs-add')?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(vi.mocked(open)).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }))
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(5)
    const labels = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')).map(tab => tab.textContent)
    expect(labels[0]).toContain('· a')
    expect(labels[1]).toContain('· b')
    const selectedTabs = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"]'))
    expect(selectedTabs).toHaveLength(1)
    expect(selectedTabs[0].title).toBe('/tmp/a/notes.md')
    expect(host.querySelector('.reader-article')?.textContent).toContain('/tmp/a/notes.md')
  })

  it('一个文件读取失败时保留失败标签并显示同批成功文档', async () => {
    const paths = ['/tmp/good.md', '/tmp/failing.md']
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') {
        if (args?.filePath === paths[1]) throw new Error('文档编码无效')
        return documentFor(paths[0], '成功文档仍可阅读')
      }
      return null
    })
    vi.mocked(open).mockResolvedValue(paths)
    await renderApp()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.open-button')?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(host.querySelector('.reader-article')?.textContent).toContain('成功文档仍可阅读')
    const failedTab = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')).find(tab => tab.title === paths[1])
    expect(failedTab?.querySelector('.reader-tab-indicator.is-error')).not.toBeNull()
  })

  it('每个标签独立保留目录面板状态', async () => {
    const pathA = '/tmp/toc-A.md'
    const pathB = '/tmp/toc-B.md'
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return args?.filePath === pathA ? documentFor(pathA, 'A 文档') : documentFor(pathB, 'B 文档')
      return null
    })
    vi.mocked(open).mockResolvedValue([pathA, pathB])
    await renderApp()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.open-button')?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    const tabA = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.title === pathA)!
    const tabB = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.title === pathB)!
    const toggleToc = () => host.querySelector<HTMLButtonElement>('[aria-label="文档目录"]')?.click()

    await act(async () => tabA().click())
    await act(async () => toggleToc())
    expect(host.querySelector('.toc-popover')).not.toBeNull()

    await act(async () => tabB().click())
    expect(host.querySelector('.toc-popover')).toBeNull()
    await act(async () => toggleToc())
    expect(host.querySelector('.toc-popover')).not.toBeNull()

    await act(async () => tabA().click())
    expect(host.querySelector('.toc-popover')).not.toBeNull()
    expect(host.querySelector('.reader-article')?.textContent).toContain('A 文档')
  })

  it('超长目录只渲染可视范围标题', async () => {
    let firedFrames = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => {
      firedFrames += 1
      callback(performance.now())
    }, 0))
    const path = '/tmp/large-toc.md'
    const headings = Array.from({ length: 12_000 }, (_, index) => ({
      id: `mdstudio-section-${index}`,
      text: `章节 ${index}`,
      level: 2,
    }))
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return [path]
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return {
        ...documentFor(path, '长目录正文'),
        headings,
        html: headings.map(heading => `<h2 id="${heading.id}">${heading.text}</h2>`).join(''),
      }
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="文档目录"]')?.click())

    expect(host.querySelectorAll('.toc-item')).toHaveLength(40)
    expect(host.querySelector('.toc-virtual-spacer')).not.toBeNull()
    await act(async () => {
      for (let attempt = 0; attempt < 200 && host.querySelectorAll('.reader-article h2[id]').length < 12_000; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    })
    expect(firedFrames).toBeGreaterThan(1)
    expect(host.querySelectorAll('.reader-article h2[id]')).toHaveLength(12_000)
  })

  it('每个标签独立保留搜索词与阅读位置', async () => {
    const pathA = '/tmp/A.md'
    const pathB = '/tmp/B.md'
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return args?.filePath === pathA ? documentFor(pathA, 'Alpha 关键字') : documentFor(pathB, 'Beta 关键字')
      return null
    })
    vi.mocked(open).mockResolvedValue([pathA, pathB])
    await renderApp()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.open-button')?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    const tabA = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.title === pathA)!
    const tabB = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.title === pathB)!
    await act(async () => tabA().click())
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="搜索本文"]')?.click())
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('[aria-label="搜索本文"]')!
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Alpha')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelector<HTMLInputElement>('[aria-label="搜索本文"]')?.value).toBe('Alpha')

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 420 })
    const heading = host.querySelector('.reader-article h1')!
    const originalBounds = heading.getBoundingClientRect.bind(heading)
    heading.getBoundingClientRect = () => ({ ...originalBounds(), top: 300 })
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
      await new Promise(resolve => setTimeout(resolve, 25))
    })

    await act(async () => tabB().click())
    expect(host.querySelector<HTMLInputElement>('.search-box input')).toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="搜索本文"]')?.click())
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('[aria-label="搜索本文"]')!
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Beta')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    vi.mocked(window.scrollTo).mockClear()
    await act(async () => tabA().click())
    expect(host.querySelector<HTMLInputElement>('[aria-label="搜索本文"]')?.value).toBe('Alpha')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
    expect(vi.mocked(window.scrollTo)).toHaveBeenCalledWith({ top: 420, behavior: 'instant' })
  })

  it('十个标签各自保留搜索词、结果数和当前匹配序号', async () => {
    const paths = Array.from({ length: 10 }, (_, index) => `/tmp/search-tab-${index}.md`)
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') {
        const index = paths.indexOf(args?.filePath ?? '')
        return documentFor(args?.filePath ?? '', `Token${index} Token${index}`)
      }
      return null
    })
    vi.mocked(open).mockResolvedValue(paths)
    await renderApp()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.open-button')?.click()
      await new Promise(resolve => setTimeout(resolve, 60))
    })
    const tabFor = (path: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.title === path)!
    const enterQuery = async (query: string) => act(async () => {
      const input = host.querySelector<HTMLInputElement>('.search-box input')!
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, query)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 170))
    })

    for (let index = 0; index < paths.length; index += 1) {
      await act(async () => tabFor(paths[index]).click())
      if (!host.querySelector('.search-box')) {
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="搜索本文"]')?.click())
      }
      await enterQuery(`Token${index}`)
      expect(host.querySelector('.search-count')?.textContent).toBe('1 / 2')
      if (index % 2 === 0) {
        await act(async () => host.querySelector<HTMLInputElement>('.search-box input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
      }
    }

    for (let index = 0; index < paths.length; index += 1) {
      await act(async () => tabFor(paths[index]).click())
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 170)) })
      expect(host.querySelector<HTMLInputElement>('.search-box input')?.value).toBe(`Token${index}`)
      expect(host.querySelector('.search-count')?.textContent).toBe(index % 2 === 0 ? '2 / 2' : '1 / 2')
    }
  }, 10_000)

  it('切换标签会取消尚未完成的旧搜索结果', async () => {
    const pathA = '/tmp/search-race-A.md'
    const pathB = '/tmp/search-race-B.md'
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return args?.filePath === pathA
        ? documentFor(pathA, 'Alpha Alpha')
        : documentFor(pathB, 'Beta')
      return null
    })
    vi.mocked(open).mockResolvedValue([pathA, pathB])
    await renderApp()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.open-button')?.click()
      await new Promise(resolve => setTimeout(resolve, 120))
    })

    const tabFor = (path: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.title === path)!
    await act(async () => tabFor(pathA).click())
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="搜索本文"]')!.click())
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('.search-box input')!
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Alpha')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => tabFor(pathB).click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)) })
    expect(host.querySelector('.reader-article')?.textContent).toContain('Beta')
    expect(host.querySelector('.search-box')).toBeNull()
    expect(host.querySelector('.reader-article mark')).toBeNull()

    await act(async () => tabFor(pathA).click())
    expect(host.querySelector<HTMLInputElement>('.search-box input')?.value).toBe('Alpha')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)) })
    expect(host.querySelector('.search-count')?.textContent).toBe('1 / 2')
  })

  it('活动文件外部更新后重建搜索范围并刷新精确计数', async () => {
    const path = '/tmp/search-external-change.md'
    let version = 2
    let fileChange: ((event: { payload: { paths: string[]; operation: string } }) => void) | undefined
    tauri.isTauri.mockReturnValue(true)
    tauri.listen.mockImplementation(async (event: string, handler: (payload: unknown) => void) => {
      if (event === 'mdstudio:file-change') fileChange = handler as typeof fileChange
      return vi.fn()
    })
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return [path]
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return documentFor(path, Array(version).fill('Alpha').join(' '))
      return null
    })
    await renderApp()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="搜索本文"]')!.click())
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('.search-box input')!
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Alpha')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 170))
    })
    expect(host.querySelector('.search-count')?.textContent).toBe('1 / 2')

    expect(fileChange).toBeDefined()
    version = 3
    await act(async () => {
      fileChange?.({ payload: { paths: [path], operation: 'modified' } })
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)) })
    expect(host.querySelector('.reader-article')?.textContent).toContain('Alpha Alpha Alpha')
    expect(host.querySelector('.search-count')?.textContent).toBe('1 / 3')
  })

  it('多文件快速加载时按用户打开顺序激活最后一个成功文件', async () => {
    const paths = ['/tmp/slow-first.md', '/tmp/fast-last.md']
    const resolvers = new Map<string, (document: ReturnType<typeof documentFor>) => void>()
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation((command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return Promise.resolve([])
      if (command === 'normalize_reader_path') return Promise.resolve(args?.filePath)
      if (command === 'load_reader_document') return new Promise(resolve => resolvers.set(args?.filePath || '', resolve as (value: ReturnType<typeof documentFor>) => void))
      return Promise.resolve(null)
    })
    vi.mocked(open).mockResolvedValue(paths)
    await renderApp()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.open-button')?.click()
      await new Promise(resolve => setTimeout(resolve, 15))
    })
    await act(async () => {
      resolvers.get(paths[1])?.(documentFor(paths[1], 'last file'))
      await Promise.resolve()
    })
    await act(async () => {
      resolvers.get(paths[0])?.(documentFor(paths[0], 'first file'))
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    expect(host.querySelector('.reader-article')?.textContent).toContain('last file')
  })

  it('键盘切换、按序跳转和关闭当前标签', async () => {
    const paths = ['/tmp/one.md', '/tmp/two.md', '/tmp/three.md']
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return documentFor(args?.filePath || '')
      return null
    })
    vi.mocked(open).mockResolvedValue(paths)
    await renderApp()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.open-button')?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true })))
    expect(host.querySelector('.reader-article')?.textContent).toContain('one.md')
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true })))
    expect(host.querySelector('.reader-article')?.textContent).toContain('two.md')
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true, bubbles: true })))
    expect(host.querySelector('.reader-article')?.textContent).toContain('one.md')
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '9', metaKey: true, bubbles: true })))
    expect(host.querySelector('.reader-article')?.textContent).toContain('three.md')
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true, bubbles: true })))
    expect(vi.mocked(open)).toHaveBeenCalled()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true })))
    expect(host.querySelector('.reader-article')?.textContent).toContain('one.md')
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true })))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true })))
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(host.querySelector('.reader-article')?.textContent).toContain('one.md')
  })

  it('批量拖入 Markdown 文件逐个建标签并忽略其他文件', async () => {
    const paths = ['/tmp/drop-a.md', '/tmp/drop-b.markdown', '/tmp/not-image.png', '/tmp/drop-c.md']
    let onDrop: ((event: { payload: { type: string; paths: string[] } }) => void) | undefined
    tauri.onDragDropEvent.mockImplementation(handler => {
      onDrop = handler as (event: { payload: { type: string; paths: string[] } }) => void
      return Promise.resolve(vi.fn())
    })
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'load_reader_document') return documentFor(args?.filePath || '')
      return null
    })
    await renderApp()
    await act(async () => {
      onDrop?.({ payload: { type: 'drop', paths } })
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(host.querySelector('.reader-article')?.textContent).toContain('drop-c.md')
  })

  it('非活动文件改动标记为过期，重新激活后刷新；删除只影响对应标签', async () => {
    const pathA = '/tmp/changed.md'
    const pathB = '/tmp/untouched.md'
    let changeHandler: ((event: { payload: { paths: string[]; operation: string } }) => void) | undefined
    let revision = 1
    tauri.listen.mockImplementation((event, handler) => {
      if (event === 'mdstudio:file-change') {
        changeHandler = handler as (event: { payload: { paths: string[]; operation: string } }) => void
      }
      return Promise.resolve(vi.fn())
    })
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockImplementation(async (command: string, args?: { filePath?: string; filePaths?: string[] }) => {
      if (command === 'take_pending_open_files') return []
      if (command === 'normalize_reader_path') return args?.filePath
      if (command === 'set_reader_watch') return null
      if (command === 'load_reader_document') {
        return args?.filePath === pathA ? documentFor(pathA, `版本 ${revision}`) : documentFor(pathB, '未修改')
      }
      return null
    })
    vi.mocked(open).mockResolvedValue([pathA, pathB])
    await renderApp()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.open-button')?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(tauri.invoke.mock.calls).toContainEqual(['set_reader_watch', { filePaths: [pathA, pathB] }])
    revision = 2
    await act(async () => changeHandler?.({ payload: { paths: [pathA], operation: 'modified' } }))
    const tabA = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.title === pathA)!
    expect(tabA().querySelector('.reader-tab-indicator.is-stale')).not.toBeNull()
    await act(async () => tabA().click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
    expect(host.querySelector('.reader-article')?.textContent).toContain('版本 2')

    await act(async () => changeHandler?.({ payload: { paths: [pathA], operation: 'removed' } }))
    expect(host.querySelector('.reader-article')?.textContent).toContain('版本 2')
    expect(host.querySelector('.reader-alert')?.textContent).toContain('已删除')
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.title === pathB)?.click())
    expect(host.querySelector('.reader-article')?.textContent).toContain('未修改')
  })
})
