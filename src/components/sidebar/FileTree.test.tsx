// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../features/i18n'
import { FileTree } from './FileTree'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

let host: HTMLDivElement
let root: Root
const workspace = { path: '/docs', displayName: 'docs' }
const folder = { name: 'nested', path: '/docs/nested', isDirectory: true, documentType: null }
const markdown = { name: 'readme.md', path: '/docs/readme.md', isDirectory: false, documentType: 'markdown' as const }

function renderTree(onOpen = vi.fn(), onCreateMarkdown = vi.fn(async () => undefined)) {
  act(() => root.render(<I18nProvider locale="zh-CN"><FileTree
    workspace={workspace}
    activePath={markdown.path}
    width={250}
    collapsed={false}
    onWidthChange={vi.fn()}
    onChooseWorkspace={vi.fn()}
    onOpen={onOpen}
    onCreateMarkdown={onCreateMarkdown}
  /></I18nProvider>))
  return { onOpen, onCreateMarkdown }
}

describe('文件夹工作区文件树', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    invokeMock.mockReset()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it('先只加载工作区根目录，展开子文件夹时才按需读取', async () => {
    invokeMock.mockImplementation(async (_command: string, { directoryPath }: { directoryPath: string }) => ({
      directoryPath,
      entries: directoryPath === '/docs' ? [folder, markdown] : [{ ...markdown, name: 'nested.md', path: '/docs/nested/nested.md' }],
      truncated: false,
    }))
    await act(async () => {
      renderTree()
      await Promise.resolve()
    })
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenLastCalledWith('list_workspace_directory', { directoryPath: '/docs' })
    expect(host.querySelector('[title="/docs/readme.md"]')).not.toBeNull()
    expect(host.querySelector('[title="/docs/nested/nested.md"]')).toBeNull()

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.folder-row')!.click()
      await Promise.resolve()
    })
    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).toHaveBeenLastCalledWith('list_workspace_directory', { directoryPath: '/docs/nested' })
    expect(host.querySelector('[title="/docs/nested/nested.md"]')).not.toBeNull()
  })

  it('高亮当前标签并将文件点击交给现有文档打开回调', async () => {
    invokeMock.mockResolvedValue({ directoryPath: '/docs', entries: [markdown], truncated: false })
    const result = renderTree()
    await act(async () => { await Promise.resolve() })
    expect(host.querySelector('[role="treeitem"][aria-selected="true"]')).not.toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('.file-row')!.click())
    expect(result.onOpen).toHaveBeenCalledWith(markdown.path)
  })

  it('新建文件回调失败时保留输入并显示可读错误', async () => {
    invokeMock.mockResolvedValue({ directoryPath: '/docs', entries: [], truncated: false })
    const create = vi.fn(async () => { throw new Error('目标文件已存在：readme.md') })
    renderTree(vi.fn(), create)
    await act(async () => { await Promise.resolve() })
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="新建 Markdown 文件"]')!.click())
    const input = host.querySelector<HTMLInputElement>('[aria-label="新建 Markdown 文件名"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'readme.md')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      host.querySelector<HTMLFormElement>('.workspace-new-file')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(create).toHaveBeenCalledWith('/docs', 'readme.md')
    expect(host.textContent).toContain('目标文件已存在，请使用其他名称。')
  })

})
