// @vitest-environment jsdom
import mermaid from 'mermaid'
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { sanitizeMermaidSvg } from '../components/reader/MermaidDiagram'

Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
  configurable: true,
  value: () => 80,
})
Object.defineProperty(SVGElement.prototype, 'getBBox', {
  configurable: true,
  value: () => ({ x: 0, y: 0, width: 80, height: 16 }),
})

it('真实 Mermaid 深色主题 style fill 会以重要内联样式调整标签对比度', async () => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    theme: 'base',
    themeVariables: { primaryColor: '#17243a', primaryTextColor: '#f8fafc', textColor: '#f8fafc' },
  })
  const { svg } = await mermaid.render(
    'mdstudio-mermaid-style-integration',
    'graph TB\n    A[开始] --> B[结束]\n    style A fill:#e1f5fe\n',
  )

  expect(svg).toContain('fill:#e1f5fe !important')
  const safeSvg = sanitizeMermaidSvg(svg)
  const parsed = new DOMParser().parseFromString(safeSvg.markup, 'image/svg+xml')
  const styledNode = parsed.querySelector('#mdstudio-mermaid-style-integration-flowchart-A-0')
  const label = styledNode?.querySelector('text')

  expect(styledNode?.querySelector('rect')?.getAttribute('style')).toContain('#e1f5fe')
  expect(label?.style.getPropertyValue('fill')).toBe('rgb(15, 23, 42)')
  expect(label?.style.getPropertyPriority('fill')).toBe('important')
})

it('完整会议流程图能够生成并安全挂载复杂 SVG', async () => {
  const fixture = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/mermaid/meeting-flow.md'), 'utf8')
  const match = fixture.match(/^```mermaid\n([\s\S]*?)^```/m)
  expect(match).not.toBeNull()
  const source = match![1]

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    theme: 'base',
    flowchart: { useMaxWidth: false },
  })
  await expect(mermaid.parse(source)).resolves.toBeTruthy()
  const renderHost = document.createElement('div')
  renderHost.style.cssText = 'position:fixed;left:-100000px;top:0;width:100vw;visibility:hidden;'
  document.body.append(renderHost)
  let svg: string
  try {
    ({ svg } = await mermaid.render('mdstudio-integration-meeting-flow', source, renderHost))
  } finally {
    renderHost.remove()
  }
  const safeSvg = sanitizeMermaidSvg(svg)
  const parsed = new DOMParser().parseFromString(safeSvg.markup, 'image/svg+xml')

  expect(parsed.documentElement.localName).toBe('svg')
  expect(parsed.documentElement.getAttribute('viewBox')).toMatch(/^-?\d+(?:\.\d+)? -?\d+(?:\.\d+)? [1-9]\d*(?:\.\d+)? [1-9]\d*(?:\.\d+)?$/)
  expect(parsed.querySelectorAll('g.node').length).toBeGreaterThanOrEqual(26)
  expect(parsed.querySelectorAll('path.flowchart-link').length).toBeGreaterThanOrEqual(25)
  for (const label of ['会议开始', '八爪鱼设备连接?', '知识库集成', '流程结束']) {
    expect(parsed.querySelector('svg')?.textContent).toContain(label)
  }
  for (const color of ['#e1f5fe', '#e8f5e8', '#fff3e0', '#f3e5f5']) {
    expect(safeSvg.markup).toContain(color)
  }
  expect(parsed.querySelector('script, image, foreignObject, [onload]')).toBeNull()
  expect(document.querySelectorAll('svg')).toHaveLength(0)
})
