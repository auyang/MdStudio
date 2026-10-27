import { describe, expect, it } from 'vitest'
import {
  emptyNavigationHistory,
  MAX_NAVIGATION_ENTRIES,
  moveNavigation,
  recordNavigation,
  type ReadingLocation,
} from './navigation'

function location(filePath: string, headingId?: string, scrollTop = 0): ReadingLocation {
  return { filePath, headingId, scrollTop, scrollRatio: 0, restoreMode: 'position' }
}

describe('reader navigation history', () => {
  it('records exact document positions and moves back and forward', () => {
    const origin = location('/docs/overview.md', 'mdstudio-example', 742)
    const target = { ...location('/docs/detail.md', 'mdstudio-接口说明'), restoreMode: 'heading' as const }
    const recorded = recordNavigation(emptyNavigationHistory, origin, target)

    const back = moveNavigation(recorded, -1, location('/docs/detail.md', 'mdstudio-接口说明', 95))
    expect(back.target).toEqual(origin)
    expect(back.history.entries[1].scrollTop).toBe(95)

    const forward = moveNavigation(back.history, 1, location('/docs/overview.md', 'mdstudio-example', 760))
    expect(forward.target?.filePath).toBe('/docs/detail.md')
    expect(forward.target?.headingId).toBe('mdstudio-接口说明')
  })

  it('truncates the forward branch after a new explicit navigation', () => {
    let history = recordNavigation(emptyNavigationHistory, location('/a.md', 'one'), location('/b.md', 'two'))
    history = recordNavigation(history, location('/b.md', 'two'), location('/old-forward.md', 'old'))
    history = moveNavigation(history, -1).history
    history = recordNavigation(history, location('/b.md', 'two'), location('/c.md', 'three'))

    expect(history.entries.map(item => item.filePath)).toEqual(['/a.md', '/b.md', '/c.md'])
    expect(history.currentIndex).toBe(2)
    expect(moveNavigation(history, -1).target?.filePath).toBe('/b.md')
  })

  it('does not add ordinary scroll positions or duplicate destinations', () => {
    const history = recordNavigation(emptyNavigationHistory, location('/a.md', 'one'), location('/a.md', 'two'))
    expect(recordNavigation(history, location('/a.md', 'two', 400), location('/a.md', 'two', 700))).toBe(history)
    expect(history.entries).toHaveLength(2)
  })

  it('keeps no more than 100 navigation entries', () => {
    let history = emptyNavigationHistory
    for (let index = 1; index <= 120; index += 1) {
      history = recordNavigation(history, location(`/doc-${index - 1}.md`), location(`/doc-${index}.md`))
    }
    expect(history.entries).toHaveLength(MAX_NAVIGATION_ENTRIES)
    expect(history.entries.at(-1)?.filePath).toBe('/doc-120.md')
    expect(history.currentIndex).toBe(MAX_NAVIGATION_ENTRIES - 1)
  })
})
