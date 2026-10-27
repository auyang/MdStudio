// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidDiagram, readSvgViewBox, sanitizeMermaidSvg } from '../components/reader/MermaidDiagram'

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({ default: mermaidMock }))

const source = 'graph TB\n    A[开始] --> B[结束]\n'
const unsafeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"><script>alert(1)</script><image href="https://example.com/x.png"/><foreignObject><div>不可信 HTML</div></foreignObject><g class="node" onload="alert(2)"><rect style="fill:#e1f5fe !important;stroke:#3b82f6"/><a href="https://example.com"><text>结束</text></a></g></svg>'
let root: Root | null = null
let container: HTMLDivElement | null = null

async function waitForRender() {
  await act(async () => {
    await new Promise(resolve => window.setTimeout(resolve, 25))
  })
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  mermaidMock.initialize.mockReset()
  mermaidMock.parse.mockReset().mockResolvedValue({ diagramType: 'flowchart-v2' })
  mermaidMock.render.mockReset().mockResolvedValue({ svg: unsafeSvg, diagramType: 'flowchart-v2' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
})

describe('MermaidDiagram 安全与错误回退', () => {
  it('SVG 缺少 viewBox 时只从有效尺寸回退，不接受百分比和零尺寸', () => {
    const explicitSize = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    explicitSize.setAttribute('width', '640px')
    explicitSize.setAttribute('height', '320')
    expect(readSvgViewBox(explicitSize)).toEqual({ x: 0, y: 0, width: 640, height: 320 })
    expect(explicitSize.getAttribute('viewBox')).toBe('0 0 640 320')

    const percentageSize = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    percentageSize.setAttribute('width', '100%')
    percentageSize.setAttribute('height', '100%')
    expect(() => readSvgViewBox(percentageSize)).toThrow('缺少有效尺寸')
  })

  it('严格初始化、清洗 SVG、提供源码复制和重试', async () => {
    await act(async () => root?.render(<MermaidDiagram source={source} language="mermaid" theme="light" />))
    await waitForRender()

    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', htmlLabels: false }))
    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({
      themeVariables: expect.objectContaining({ primaryTextColor: '#0f172a' }),
    }))
    expect(mermaidMock.parse).toHaveBeenCalledWith(source)
    expect(container?.querySelector('svg')).not.toBeNull()
    expect(container?.querySelector('script, image, foreignObject, [onload]')).toBeNull()
    expect(container?.querySelector('a[href^="https:"]')).toBeNull()
    expect(container?.querySelector('[style]')?.getAttribute('style')).toContain('#e1f5fe')
    expect(container?.querySelector('.node text')?.style.getPropertyValue('fill')).toBe('rgb(15, 23, 42)')
    expect(container?.querySelector('.node text')?.style.getPropertyPriority('fill')).toBe('important')
    expect(sanitizeMermaidSvg(unsafeSvg).contrastAdjusted).toBe(1)
    expect(sanitizeMermaidSvg(unsafeSvg).changed).toBe(true)

    const sourceButton = Array.from(container?.querySelectorAll('button') ?? []).find(button => button.textContent === '查看源码')
    await act(async () => sourceButton?.click())
    expect(container?.querySelector('.reader-mermaid-source code')?.textContent).toBe(source)

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
    const copyButton = Array.from(container?.querySelectorAll('button') ?? []).find(button => button.textContent === '复制源码')
    await act(async () => copyButton?.click())
    await waitForRender()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(source)
    expect(container?.textContent).toContain('源码已复制')

    const retryButton = Array.from(container?.querySelectorAll('button') ?? []).find(button => button.textContent === '重试渲染')
    await act(async () => retryButton?.click())
    await waitForRender()
    expect(mermaidMock.render).toHaveBeenCalledTimes(2)
    expect(new Set(mermaidMock.render.mock.calls.map(([id]) => id)).size).toBe(2)
  })

  it('解析失败时保留错误、源码和重试入口', async () => {
    mermaidMock.parse.mockRejectedValueOnce(new Error('Parse error on line 2'))
    await act(async () => root?.render(<MermaidDiagram source={source} language="mermaid" theme="dark" />))
    await waitForRender()

    expect(container?.textContent).toContain('Mermaid 流程图渲染失败')
    expect(container?.textContent).toContain('Parse error on line 2')
    expect(mermaidMock.render).not.toHaveBeenCalled()
    expect(container?.querySelector('.reader-mermaid-svg')).not.toBeNull()
    expect(Array.from(container?.querySelectorAll('button') ?? []).some(button => button.textContent === '查看源码')).toBe(true)
    expect(Array.from(container?.querySelectorAll('button') ?? []).some(button => button.textContent === '重试渲染')).toBe(true)

    const buttons = Array.from(container?.querySelectorAll('button') ?? [])
    const sourceButton = buttons.find(button => button.textContent === '查看源码')
    await act(async () => sourceButton?.click())
    expect(container?.querySelector('.reader-mermaid-source code')?.textContent).toBe(source)

    const retryButton = buttons.find(button => button.textContent === '重试渲染')
    await act(async () => retryButton?.click())
    await waitForRender()
    expect(container?.querySelector('svg')).not.toBeNull()
    expect(mermaidMock.initialize).toHaveBeenLastCalledWith(expect.objectContaining({
      themeVariables: expect.objectContaining({ primaryTextColor: '#f8fafc' }),
    }))
  })

  it('多个图表同时存在时使用不同 SVG ID', async () => {
    await act(async () => root?.render(<>
      <MermaidDiagram source={source} language="mermaid" theme="light" />
      <MermaidDiagram source="graph LR\n    A[甲] --> B[乙]\n" language="mermaid" theme="light" />
    </>))
    await waitForRender()

    expect(container?.querySelectorAll('svg')).toHaveLength(2)
    const ids = mermaidMock.render.mock.calls.map(([id]) => id)
    expect(new Set(ids).size).toBe(2)
  })

  it('报告内容安全策略阻止', async () => {
    await act(async () => root?.render(<MermaidDiagram source={source} language="mermaid" theme="light" />))
    await waitForRender()

    const violation = new Event('securitypolicyviolation') as SecurityPolicyViolationEvent
    Object.defineProperties(violation, {
      violatedDirective: { value: 'img-src' },
      blockedURI: { value: 'https://example.org/private-image.png' },
    })
    await act(async () => { window.dispatchEvent(violation) })

    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('内容安全策略阻止了图表资源')
    expect(console.info).toHaveBeenCalledWith('[MdStudio Mermaid]', expect.objectContaining({
      event: 'csp-or-security-filter-error',
      directive: 'img-src',
    }))
  })

  it('成功图表可独立放大、查看和复制源码，并通过 Esc 关闭且恢复焦点', async () => {
    await act(async () => root?.render(<MermaidDiagram source={source} language="mermaid" theme="light" />))
    await waitForRender()

    const zoomButton = Array.from(container?.querySelectorAll('button') ?? []).find(button => button.textContent === '放大查看')
    expect(zoomButton).toBeDefined()
    await act(async () => zoomButton?.click())
    await waitForRender()

    const dialog = document.body.querySelector('[role="dialog"]')
    const canvas = document.body.querySelector<HTMLElement>('.reader-mermaid-viewer-canvas')
    expect(dialog).not.toBeNull()
    expect(document.body.querySelectorAll('.reader-mermaid-viewer-scene svg')).toHaveLength(1)
    expect(mermaidMock.render.mock.calls).toHaveLength(2)
    expect(mermaidMock.render.mock.calls[0][0]).not.toBe(mermaidMock.render.mock.calls[1][0])

    canvas!.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
    await act(async () => window.dispatchEvent(new Event('resize')))
    const zoomReadout = document.body.querySelector('[aria-label="当前缩放比例"]')
    expect(zoomReadout?.textContent).toBe('400%')

    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
    const button = (label: string) => buttons.find(item => item.textContent === label || item.getAttribute('aria-label') === label)
    await act(async () => button('100%')?.click())
    expect(zoomReadout?.textContent).toBe('100%')
    await act(async () => button('放大图表')?.click())
    expect(zoomReadout?.textContent).toBe('120%')

    await act(async () => button('查看源码')?.click())
    expect(document.body.querySelector('.reader-mermaid-viewer-source code')?.textContent).toBe(source)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
    await act(async () => button('复制源码')?.click())
    await waitForRender()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(source)

    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await waitForRender()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(zoomButton)
  })

  it('画布滚轮只在查看器内缩放，拖动平移图表', async () => {
    await act(async () => root?.render(<MermaidDiagram source={source} language="mermaid" theme="light" />))
    await waitForRender()
    const zoomButton = Array.from(container?.querySelectorAll('button') ?? []).find(button => button.textContent === '放大查看')
    await act(async () => zoomButton?.click())
    await waitForRender()

    const canvas = document.body.querySelector<HTMLElement>('.reader-mermaid-viewer-canvas')!
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
    const initialTransform = document.body.querySelector<HTMLElement>('.reader-mermaid-viewer-scene')!.style.transform
    const wheel = new WheelEvent('wheel', { deltaY: -100, clientX: 240, clientY: 180, bubbles: true, cancelable: true })
    await act(async () => { canvas.dispatchEvent(wheel) })
    expect(wheel.defaultPrevented).toBe(true)
    expect(document.body.querySelector('[aria-label="当前缩放比例"]')?.textContent).not.toBe('100%')

    const Pointer = window.PointerEvent ?? MouseEvent
    await act(async () => {
      canvas.dispatchEvent(new Pointer('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true }))
      canvas.dispatchEvent(new Pointer('pointermove', { button: 0, clientX: 150, clientY: 135, bubbles: true }))
      canvas.dispatchEvent(new Pointer('pointerup', { button: 0, clientX: 150, clientY: 135, bubbles: true }))
    })
    const movedTransform = document.body.querySelector<HTMLElement>('.reader-mermaid-viewer-scene')!.style.transform
    expect(movedTransform).not.toBe(initialTransform)
  })

  it('适应窗口可以低于 25% 显示超宽图，100% 和重置有明确基准', async () => {
    const veryWideSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 1000" width="10000" height="1000"><path d="M0 0 L10000 1000"/></svg>'
    mermaidMock.render.mockResolvedValue({ svg: veryWideSvg, diagramType: 'flowchart-v2' })
    await act(async () => root?.render(<MermaidDiagram source={source} language="mermaid" theme="light" />))
    await waitForRender()
    const zoomButton = Array.from(container?.querySelectorAll('button') ?? []).find(button => button.textContent === '放大查看')
    await act(async () => zoomButton?.click())
    await waitForRender()
    const canvas = document.body.querySelector<HTMLElement>('.reader-mermaid-viewer-canvas')!
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
    await act(async () => window.dispatchEvent(new Event('resize')))
    const readout = document.body.querySelector('[aria-label="当前缩放比例"]')
    expect(readout?.textContent).toBe('8%')

    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
    await act(async () => buttons.find(button => button.textContent === '100%')?.click())
    expect(readout?.textContent).toBe('100%')
    await act(async () => buttons.find(button => button.textContent === '重置')?.click())
    expect(readout?.textContent).toBe('8%')
  })

  it('快速开关 20 次后没有残留画布或滚轮/窗口监听器', async () => {
    const addElementListener = vi.spyOn(HTMLElement.prototype, 'addEventListener')
    const removeElementListener = vi.spyOn(HTMLElement.prototype, 'removeEventListener')
    const addWindowListener = vi.spyOn(window, 'addEventListener')
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    await act(async () => root?.render(<MermaidDiagram source={source} language="mermaid" theme="light" />))
    await waitForRender()
    const zoomButton = Array.from(container?.querySelectorAll('button') ?? []).find(button => button.textContent === '放大查看')

    for (let index = 0; index < 20; index += 1) {
      await act(async () => zoomButton?.click())
      await waitForRender()
      const closeButton = document.body.querySelector<HTMLButtonElement>('[aria-label="关闭放大查看"]')
      await act(async () => closeButton?.click())
      await waitForRender()
    }

    const wheelAdds = addElementListener.mock.calls.reduce((count, [type], index) => count + (
      type === 'wheel' && (addElementListener.mock.contexts[index] as HTMLElement).classList?.contains('reader-mermaid-viewer-canvas') ? 1 : 0
    ), 0)
    const wheelRemoves = removeElementListener.mock.calls.reduce((count, [type], index) => count + (
      type === 'wheel' && (removeElementListener.mock.contexts[index] as HTMLElement).classList?.contains('reader-mermaid-viewer-canvas') ? 1 : 0
    ), 0)
    const resizeAdds = addWindowListener.mock.calls.filter(([type]) => type === 'resize').length
    const resizeRemoves = removeWindowListener.mock.calls.filter(([type]) => type === 'resize').length
    expect(wheelAdds).toBeGreaterThanOrEqual(20)
    expect(wheelRemoves).toBe(wheelAdds)
    expect(resizeAdds).toBe(20)
    expect(resizeRemoves).toBe(resizeAdds)
    expect(document.body.querySelector('.reader-mermaid-viewer-backdrop')).toBeNull()
    expect(document.body.querySelector('.mdstudio-mermaid-measurement-host')).toBeNull()
  })

  it('放大视图渲染失败时保留错误、重试和源码入口', async () => {
    mermaidMock.render.mockResolvedValueOnce({ svg: unsafeSvg, diagramType: 'flowchart-v2' })
    mermaidMock.render.mockRejectedValueOnce(new Error('Diagram render failed'))
    await act(async () => root?.render(<MermaidDiagram source={source} language="mermaid" theme="light" />))
    await waitForRender()
    const zoomButton = Array.from(container?.querySelectorAll('button') ?? []).find(button => button.textContent === '放大查看')
    await act(async () => zoomButton?.click())
    await waitForRender()

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Diagram render failed')
    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
    expect(buttons.some(button => button.textContent === '查看源码')).toBe(true)
    expect(buttons.some(button => button.textContent === '复制源码')).toBe(true)
    expect(buttons.some(button => button.textContent === '重试渲染')).toBe(true)
  })
})
