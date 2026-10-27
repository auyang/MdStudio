// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadingWidthPicker } from './ReadingWidthPicker'

let host: HTMLDivElement
let root: Root

describe('底部阅读宽度快捷菜单', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it('显示当前宽度，并在选择后回调和关闭菜单', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(<ReadingWidthPicker value="wide" onChange={onChange} />))
    const details = host.querySelector('details')!
    expect(host.querySelector('summary')?.textContent).toContain('宽屏')
    expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('980px')

    details.open = true
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-pressed="false"]')?.click())
    expect(onChange).toHaveBeenCalledWith('compact')
    expect(details.open).toBe(false)
  })
})
