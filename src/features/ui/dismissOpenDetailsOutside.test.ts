// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { dismissOpenDetailsOutside } from './dismissOpenDetailsOutside'

describe('关闭外部 details 菜单', () => {
  afterEach(() => { document.body.replaceChildren() })

  it('点击菜单外部时关闭打开的菜单', () => {
    const menu = document.createElement('details')
    menu.dataset.dismissOutside = 'true'
    menu.open = true
    const outside = document.createElement('button')
    document.body.append(menu, outside)

    dismissOpenDetailsOutside(outside)

    expect(menu.open).toBe(false)
  })

  it('点击菜单内部时保持打开', () => {
    const menu = document.createElement('details')
    menu.dataset.dismissOutside = 'true'
    menu.open = true
    const inside = document.createElement('button')
    menu.append(inside)
    document.body.append(menu)

    dismissOpenDetailsOutside(inside)

    expect(menu.open).toBe(true)
  })
})
