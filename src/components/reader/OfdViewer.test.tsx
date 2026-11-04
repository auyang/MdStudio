// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../features/i18n'
import { OfdViewer } from './OfdViewer'
import type { OfdReaderDocument } from '../../features/documents/ofd/reader'
import type { OFDViewerHandle } from '@ofdrw/ofdrw-viewer-ui/react'

const viewerProbe = vi.hoisted(() => ({ props: null as Record<string, unknown> | null, close: vi.fn(async () => undefined), state: null as unknown }))
const tauriProbe = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriProbe.invoke }))

vi.mock('@ofdrw/ofdrw-viewer-ui/react', async () => {
  const React = await import('react')
  return {
    OFDViewer: React.forwardRef((props: Record<string, unknown>, ref: React.ForwardedRef<OFDViewerHandle>) => {
      viewerProbe.props = props
      React.useImperativeHandle(ref, () => ({
        getInstance: () => null,
        getViewer: () => ({ clearFind: vi.fn(), findNext: vi.fn(), findPrevious: vi.fn() }) as never,
        open: vi.fn(async () => undefined), close: viewerProbe.close,
        goToPage: vi.fn(), nextPage: vi.fn(), previousPage: vi.fn(), setScale: vi.fn(), setZoomMode: vi.fn(),
        setRotation: vi.fn(), setFeatures: vi.fn(), find: vi.fn(async () => undefined), print: vi.fn(async () => undefined),
        getState: () => viewerProbe.state as never, getFeatureState: () => null, isFeatureEnabled: () => false,
        verify: vi.fn(async () => ({} as never)), getVerificationReport: () => undefined,
        setRootCertificates: vi.fn(async () => []), getRootCertificates: () => [], openVerificationPanel: vi.fn(),
        getLocalFontsStatus: () => ({}) as never, setLocalFontsEnabled: vi.fn(async () => undefined), onLocalFontsStatusChange: () => () => undefined,
      }))
      return React.createElement('div', { 'data-testid': 'mock-ofd-engine', className: 'ofd-viewer__main' })
    }),
  }
})

let host: HTMLDivElement
let root: Root

const sample: OfdReaderDocument = {
  documentType: 'ofd',
  filePath: '/tmp/电子票据.ofd',
  fileName: '电子票据.ofd',
  byteSize: 4,
  modifiedUnixMicros: 100,
  pageCount: 2,
  hasSignatures: true,
  resourceWarnings: ['缺失资源：Doc/Res/a.png'],
  fontResources: [],
  bytes: new Uint8Array([0x50, 0x4b, 3, 4]),
}

describe('OFD 阅读器适配组件', () => {
  beforeEach(() => {
    viewerProbe.props = null
    viewerProbe.state = null
    viewerProbe.close.mockClear()
    tauriProbe.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'resolve_ofd_system_fonts') {
        return {
          sessionId: args?.sessionId,
          sources: [{ index: 0, family: 'PingFang SC', coveredCharacters: 2, requiredCharacters: 2 }],
          aliases: [['楷体', 'PingFang SC']],
          missingFontNames: [],
        }
      }
      if (command === 'read_ofd_system_font') return new Uint8Array([1, 2, 3]).buffer
      return undefined
    })
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    host.remove()
  })

  it('关闭第三方工具栏、验签和选择，只启用本地文字层查找并显示未验证签章', async () => {
    const onReadingChange = vi.fn()
    const onPageCountChange = vi.fn()
    const onOutlineChange = vi.fn()
    const onSearchChange = vi.fn()
    const onSearchPendingChange = vi.fn()
    const ref = { current: null as OFDViewerHandle | null }
    await act(async () => root.render(<I18nProvider locale="zh-CN"><OfdViewer
      ref={ref}
      tabId="ofd-tab"
      document={sample}
      locale="zh-CN"
      dark
      initialPage={2}
      initialScale={1.25}
      initialRotation={90}
      searchOpen
      searchQuery="发票"
      onReadingChange={onReadingChange}
      onPageCountChange={onPageCountChange}
      onOutlineChange={onOutlineChange}
      onSearchChange={onSearchChange}
      onSearchPendingChange={onSearchPendingChange}
    /></I18nProvider>))

    expect(viewerProbe.props).toMatchObject({
      features: { toolbar: false, print: false, export: false, verification: false, selection: false, find: true, textLayer: true },
      page: 2,
      scale: 1.25,
      rotation: 90,
      maxCanvasDim: 8192,
      pageCacheSize: 4,
      renderConcurrency: 1,
      source: sample.bytes,
      debug: { console: false },
    })
    expect(host.textContent).not.toContain('签章未验证')
    expect(host.textContent).not.toContain('文档兼容性诊断')
    expect(host.textContent).not.toContain('缺失资源')
    const props = viewerProbe.props as Record<string, (payload: never) => void>
    await act(async () => {
      props.onReady?.()
      await Promise.resolve()
    })
    expect(onSearchPendingChange).toHaveBeenCalledWith('ofd-tab', true)
    await act(async () => {
      props.onDocumentOpen({ pageCount: 2 } as never)
      props.onPageChange({ pageNumber: 1 } as never)
      props.onFindMatches({ query: '发票', total: 3, current: 2 } as never)
    })
    expect(onPageCountChange).toHaveBeenCalledWith('ofd-tab', 2)
    expect(onOutlineChange).toHaveBeenCalledWith('ofd-tab', [])
    expect(onReadingChange).toHaveBeenCalledWith('ofd-tab', 1, 1.25, 90)
    expect(onSearchChange).toHaveBeenCalledWith('ofd-tab', 3, 1)
    expect(onSearchPendingChange).toHaveBeenLastCalledWith('ofd-tab', false)
  })

  it('日语界面隐藏第三方未翻译文案且阅读区不显示兼容性诊断', async () => {
    await act(async () => root.render(<I18nProvider locale="ja"><OfdViewer
      tabId="ofd-ja-tab"
      document={sample}
      locale="ja"
      dark={false}
      initialPage={1}
      initialScale={1}
      initialRotation={0}
      searchOpen={false}
      searchQuery=""
      onReadingChange={vi.fn()}
      onPageCountChange={vi.fn()}
      onOutlineChange={vi.fn()}
      onSearchChange={vi.fn()}
      onSearchPendingChange={vi.fn()}
    /></I18nProvider>))

    expect(viewerProbe.props?.locale).toBe('zh-CN')
    expect(host.textContent).not.toContain('文档兼容性诊断')
    expect(host.textContent).not.toContain('互換性の診断')
    expect(host.textContent).not.toContain('Font missing: KaiTi')
    expect(host.textContent).not.toContain('缺失资源：Doc/Res/a.png')
  })

  it('隐藏引擎兼容性警告但保留渲染错误提示', async () => {
    await act(async () => root.render(<I18nProvider locale="zh-CN"><OfdViewer
      tabId="ofd-diagnostics-tab"
      document={{ ...sample, hasSignatures: false, resourceWarnings: [], fontResources: [] }}
      locale="zh-CN"
      dark={false}
      initialPage={1}
      initialScale={1}
      initialRotation={0}
      searchOpen={false}
      searchQuery=""
      onReadingChange={vi.fn()}
      onPageCountChange={vi.fn()}
      onOutlineChange={vi.fn()}
      onSearchChange={vi.fn()}
      onSearchPendingChange={vi.fn()}
    /></I18nProvider>))

    const props = viewerProbe.props as Record<string, (payload: never) => void>
    await act(async () => {
      props.onError({ code: 'E_PAGE_RENDER', message: '页面画布创建失败', pageIndex: 1 } as never)
    })

    expect(host.querySelector('[data-testid="ofd-compatibility-diagnostics"]')).toBeNull()
    expect(host.textContent).not.toContain('文档兼容性诊断')
    expect(host.textContent).toContain('OFD 页面渲染失败')
    expect(host.textContent).toContain('页面画布创建失败')
  })

  it('渲染失败时保留阅读器区域和真实错误，可触发重试并释放组件实例', async () => {
    await act(async () => root.render(<I18nProvider locale="zh-CN"><OfdViewer
      tabId="ofd-tab"
      document={sample}
      locale="zh-CN"
      dark={false}
      initialPage={1}
      initialScale={1}
      initialRotation={0}
      searchOpen={false}
      searchQuery=""
      onReadingChange={vi.fn()}
      onPageCountChange={vi.fn()}
      onOutlineChange={vi.fn()}
      onSearchChange={vi.fn()}
      onSearchPendingChange={vi.fn()}
    /></I18nProvider>))
    const props = viewerProbe.props as Record<string, (payload: never) => void>
    await act(async () => props.onError({ code: 'E_PAGE_RENDER', message: '画布尺寸超过引擎上限', pageIndex: 1 } as never))
    expect(host.textContent).toContain('OFD 页面渲染失败')
    expect(host.textContent).toContain('画布尺寸超过引擎上限')
    expect(host.querySelector('[data-testid="ofd-viewer-host"]')).not.toBeNull()
    await act(async () => root.unmount())
    expect(viewerProbe.close).toHaveBeenCalled()
  })

  it('按需加载系统字体，并在关闭旧 Viewer 完成后释放字体会话', async () => {
    let finishClose = () => undefined
    const closePromise = new Promise<void>(resolve => { finishClose = resolve })
    viewerProbe.close.mockImplementationOnce(() => closePromise)
    const documentWithFont = {
      ...sample,
      fontResources: [{
        id: 'font-1', fontName: '楷体', charset: 'unicode', serif: true, bold: false, italic: false,
        fixedSize: false, requiredCharacters: '中文',
      }],
    }
    const onReadingChange = vi.fn()
    const onPageCountChange = vi.fn()
    const onOutlineChange = vi.fn()
    const onSearchChange = vi.fn()
    const onSearchPendingChange = vi.fn()
    const props = {
      tabId: 'ofd-tab', document: documentWithFont, locale: 'zh-CN' as const, dark: false,
      systemFontFallback: true, fallbackFont: 'auto' as const, initialPage: 1, initialScale: 1,
      initialRotation: 0, searchOpen: false, searchQuery: '', onReadingChange, onPageCountChange,
      onOutlineChange, onSearchChange, onSearchPendingChange,
    }

    await act(async () => {
      root.render(<I18nProvider locale="zh-CN"><OfdViewer {...props} /></I18nProvider>)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(tauriProbe.invoke).toHaveBeenCalledWith('resolve_ofd_system_fonts', expect.objectContaining({ fallbackPreference: 'auto' }))
    const resolutionCall = tauriProbe.invoke.mock.calls.find(([command]) => command === 'resolve_ofd_system_fonts')
    const sessionId = (resolutionCall?.[1] as { sessionId: string }).sessionId
    const viewerProps = viewerProbe.props as Record<string, unknown> & { fonts: { supplementary: Array<{ path: string }>; loader: (source: { path: string }) => Promise<Uint8Array> } }
    expect(viewerProps.fonts.supplementary[0].path).toBe(`mdstudio-system-font:${sessionId}:0`)
    await act(async () => expect(await viewerProps.fonts.loader({ path: viewerProps.fonts.supplementary[0].path })).toEqual(new Uint8Array([1, 2, 3])))

    await act(async () => {
      root.render(<I18nProvider locale="zh-CN"><OfdViewer {...props} systemFontFallback={false} /></I18nProvider>)
      await Promise.resolve()
    })
    expect(tauriProbe.invoke.mock.calls.filter(([command]) => command === 'release_ofd_system_fonts')).toHaveLength(0)
    await act(async () => { finishClose(); await closePromise })
    expect(tauriProbe.invoke.mock.calls.filter(([command, args]) => command === 'release_ofd_system_fonts' && (args as { sessionId?: string })?.sessionId === sessionId)).toHaveLength(1)
  })

  it('字体策略重新挂载 Viewer 后恢复同一文档的滚动位置', async () => {
    const documentWithFont = {
      ...sample,
      fontResources: [{
        id: 'font-1', fontName: '宋体', charset: 'unicode', serif: true, bold: false, italic: false,
        fixedSize: false, requiredCharacters: '中文',
      }],
    }
    const props = {
      tabId: 'ofd-tab', document: documentWithFont, locale: 'zh-CN' as const, dark: false,
      systemFontFallback: true, fallbackFont: 'auto' as const, initialPage: 1, initialScale: 1,
      initialRotation: 0, searchOpen: false, searchQuery: '', onReadingChange: vi.fn(), onPageCountChange: vi.fn(),
      onOutlineChange: vi.fn(), onSearchChange: vi.fn(), onSearchPendingChange: vi.fn(),
    }

    await act(async () => {
      root.render(<I18nProvider locale="zh-CN"><OfdViewer {...props} /></I18nProvider>)
      await Promise.resolve()
      await Promise.resolve()
    })
    const firstReady = viewerProbe.props as Record<string, (payload: never) => void>
    await act(async () => firstReady.onReady?.())
    const originalScroller = host.querySelector<HTMLElement>('.ofd-viewer__main')
    expect(originalScroller).not.toBeNull()
    originalScroller!.scrollTop = 247
    viewerProbe.state = { view: { scrollTop: 247 }, document: { outline: [] } }

    await act(async () => {
      root.render(<I18nProvider locale="zh-CN"><OfdViewer {...props} systemFontFallback={false} /></I18nProvider>)
      await Promise.resolve()
    })
    await act(async () => {
      root.render(<I18nProvider locale="zh-CN"><OfdViewer {...props} /></I18nProvider>)
      await Promise.resolve()
      await Promise.resolve()
    })
    const nextReady = viewerProbe.props as Record<string, (payload: never) => void>
    await act(async () => nextReady.onReady?.())
    expect(host.querySelector<HTMLElement>('.ofd-viewer__main')?.scrollTop).toBe(247)
  })
})
