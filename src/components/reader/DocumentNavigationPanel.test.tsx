// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../features/i18n'
import { DocumentNavigationPanel } from './DocumentNavigationPanel'
import type { PdfOutlineItem } from '../../features/documents/pdf/reader'

let host: HTMLDivElement
let root: Root

describe('分页文档导航面板', () => {
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

  it('只渲染当前页附近的缩略图，并能用 PDF 书签跳转', async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      cleanup: vi.fn(),
    }
    const pdf = {
      getPage: vi.fn(async () => page),
      getDestination: vi.fn(async () => [{}]),
      getPageIndex: vi.fn(async () => 3),
    }
    const pdfOutline: PdfOutlineItem[] = [{ title: '第三章', dest: 'chapter-3', items: [] }]
    const onPageChange = vi.fn()
    const onClose = vi.fn()
    await act(async () => root.render(<I18nProvider locale="zh-CN"><DocumentNavigationPanel
      documentType="pdf"
      locale="zh-CN"
      page={50}
      pageCount={200}
      pdfDocument={pdf as never}
      pdfOutline={pdfOutline}
      onPageChange={onPageChange}
      onClose={onClose}
    /></I18nProvider>))

    expect(host.querySelectorAll('.document-thumbnail')).toHaveLength(5)
    expect(host.querySelector('.document-thumbnail[aria-label="跳转到第 48 页"]')).not.toBeNull()
    const outlineTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '大纲')
    if (!outlineTab) throw new Error('大纲页签未生成')
    await act(async () => outlineTab.click())
    await act(async () => vi.waitFor(() => expect(host.textContent).toContain('第三章')))
    await act(async () => host.querySelector<HTMLButtonElement>('.document-outline-item')?.click())
    expect(onPageChange).toHaveBeenCalledWith(4)
    expect(onClose).toHaveBeenCalled()
  })
})
