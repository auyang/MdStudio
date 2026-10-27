// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import mermaid from 'mermaid'
import { beforeAll, describe, expect, it } from 'vitest'

const fixtureDirectory = path.resolve(process.cwd(), 'tests/fixtures/mermaid')

function fencedSource(fileName: string): string {
  const markdown = fs.readFileSync(path.join(fixtureDirectory, fileName), 'utf8')
  const match = markdown.match(/^```mermaid\n([\s\S]*?)^```/m)
  if (!match) throw new Error(`Fixture ${fileName} 缺少 Mermaid fenced block`)
  return match[1]
}

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false })
})

describe('Mermaid 图表语法 fixtures', () => {
  it.each([
    'test-a-english.md',
    'test-b-chinese.md',
    'test-c-branches.md',
    'test-d-styles.md',
    'test-g-flowchart.md',
    'meeting-flow.md',
  ])('%s 可通过 Mermaid 解析器', async (fileName) => {
    await expect(mermaid.parse(fencedSource(fileName))).resolves.toBeTruthy()
  })

  it('错误语法返回真实解析错误', async () => {
    await expect(mermaid.parse(fencedSource('test-f-invalid.md'))).rejects.toThrow()
  })

  it('多个 Mermaid 代码围栏可以分别解析', async () => {
    const markdown = fs.readFileSync(path.join(fixtureDirectory, 'test-h-multiple.md'), 'utf8')
    const sources = Array.from(markdown.matchAll(/^```mermaid\n([\s\S]*?)^```/gm), match => match[1])
    expect(sources).toHaveLength(2)
    for (const source of sources) await expect(mermaid.parse(source)).resolves.toBeTruthy()
  })
})
