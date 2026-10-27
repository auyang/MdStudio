// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_READER_SETTINGS } from '../../features/reader/preferences'
import type { ReaderSettingsV1 } from '../../features/reader/preferences'
import { SettingsDialog } from './SettingsDialog'

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('0.1.5') }))

let host: HTMLDivElement
let root: Root
let settings: ReaderSettingsV1
const callbacks = {
  onClose: vi.fn(),
  onSettingsChange: vi.fn(),
  onOpenRecent: vi.fn(),
  onRemoveRecent: vi.fn(),
  onClearRecents: vi.fn(),
  onClearPositions: vi.fn(),
  onClearSession: vi.fn(),
}

async function renderDialog(open = true) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<SettingsDialog
      open={open}
      settings={settings}
      recents={[{ path: '/docs/指南.md', openedAt: 100 }]}
      logoSrc="brand.svg"
      {...callbacks}
    />)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('阅读设置中心', () => {
  beforeEach(() => {
    settings = { ...DEFAULT_READER_SETTINGS }
    Object.values(callbacks).forEach(callback => callback.mockReset())
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    host?.remove()
    vi.unstubAllGlobals()
  })

  it('提供主题、字号和阅读宽度设置，并可单独恢复外观默认值', async () => {
    await renderDialog()
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="阅读主题"] button:nth-child(3)')?.click())
    expect(callbacks.onSettingsChange).toHaveBeenCalledWith({ theme: 'dark' })
    const font = host.querySelector<HTMLInputElement>('#reader-font-size')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(font, '20')
      font.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(callbacks.onSettingsChange).toHaveBeenCalledWith({ fontSizePx: 20 })
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="阅读宽度"] button:nth-child(3)')?.click())
    expect(callbacks.onSettingsChange).toHaveBeenCalledWith({ readingWidth: 'wide' })
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('恢复阅读默认值'))?.click())
    expect(callbacks.onSettingsChange).toHaveBeenLastCalledWith({ theme: 'system', fontSizePx: 16, readingWidth: 'wide' })
  })

  it('把最近文件与三个独立清除操作放在启动与历史分类', async () => {
    await renderDialog()
    await act(async () => host.querySelector<HTMLButtonElement>('#settings-tab-history')?.click())
    expect(host.textContent).toContain('指南.md')
    expect(host.textContent).toContain('/docs/指南.md')
    const switches = host.querySelectorAll<HTMLButtonElement>('[role="switch"]')
    await act(async () => switches[0].click())
    expect(callbacks.onSettingsChange).toHaveBeenCalledWith({ restoreTabs: false })
    await act(async () => switches[1].click())
    expect(callbacks.onSettingsChange).toHaveBeenCalledWith({ rememberPosition: false })
    await act(async () => switches[2].click())
    expect(callbacks.onSettingsChange).toHaveBeenCalledWith({ doubleClickToClose: false })
    await act(async () => host.querySelector<HTMLButtonElement>('.settings-recent-open')?.click())
    expect(callbacks.onOpenRecent).toHaveBeenCalledWith('/docs/指南.md')

    await act(async () => host.querySelector<HTMLButtonElement>('.settings-recent-remove')?.click())
    expect(callbacks.onRemoveRecent).toHaveBeenCalledWith('/docs/指南.md')
    const clearButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    await act(async () => clearButtons.find(button => button.textContent === '清空阅读位置')?.click())
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '确认清除')?.click())
    expect(callbacks.onClearPositions).toHaveBeenCalledOnce()
    await act(async () => host.querySelector<HTMLButtonElement>('.settings-text-button')?.click())
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '确认清除')?.click())
    expect(callbacks.onClearRecents).toHaveBeenCalledOnce()
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '清空恢复会话')?.click())
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '确认清除')?.click())
    expect(callbacks.onClearSession).toHaveBeenCalledOnce()
  })

  it('关于页展示正式 Logo、品牌文案和运行时版本', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root.render(<SettingsDialog
        open
        initialSection="about"
        settings={settings}
        recents={[]}
        logoSrc="brand.svg"
        {...callbacks}
      />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => { await Promise.resolve() })
    expect(host.querySelector('#settings-tab-about')?.getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('.settings-about-logo')?.getAttribute('src')).toBe('brand.svg')
    expect(host.textContent).toContain('Just Read Markdown.')
    expect(host.textContent).toContain('0.1.5')
  })

  it('Escape 关闭设置并让 Tab 焦点保持在对话框内', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    await renderDialog()
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => dialog.dispatchEvent(escape))
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    expect(escape.defaultPrevented).toBe(true)
    await act(async () => {
      root.render(<SettingsDialog open={false} settings={settings} recents={[]} logoSrc="brand.svg" {...callbacks} />)
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
