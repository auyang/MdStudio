import { describe, expect, it } from 'vitest'
import { diffHunks, mergeThreeWay } from './merge'

describe('three-way Markdown merge', () => {
  it('merges non-overlapping edits from both sides', () => {
    const base = ['标题', '本地内容', '中间段', '外部内容', '结尾'].join('\n')
    const local = ['标题', '本地已改', '中间段', '外部内容', '结尾'].join('\n')
    const remote = ['标题', '本地内容', '中间段', '外部已改', '结尾'].join('\n')

    expect(mergeThreeWay(base, local, remote)).toEqual({
      status: 'merged',
      content: ['标题', '本地已改', '中间段', '外部已改', '结尾'].join('\n'),
      conflicts: [],
    })
  })

  it('marks overlapping changes as conflicts without creating conflict markers', () => {
    const result = mergeThreeWay('a\nbase\nz', 'a\nlocal\nz', 'a\nremote\nz')
    expect(result.status).toBe('conflicts')
    expect(result.content).toBeNull()
    expect(result.conflicts[0]).toMatchObject({ base: ['base'], local: ['local'], remote: ['remote'] })
  })

  it('applies a shared identical edit once', () => {
    expect(mergeThreeWay('a\nb', 'a\nshared', 'a\nshared')).toMatchObject({
      status: 'merged',
      content: 'a\nshared',
    })
  })

  it('handles insertions and deletions while preserving final newline', () => {
    const base = 'one\ntwo\nthree\n'
    const local = 'one\nnew\ntwo\nthree\n'
    const remote = 'one\ntwo\n'
    expect(mergeThreeWay(base, local, remote)).toMatchObject({
      status: 'merged',
      content: 'one\nnew\ntwo\n',
    })
  })

  it('returns hunks for a replacement and declines pathological edit distance', () => {
    expect(diffHunks('a\nb\nc', 'a\nB\nc')).toEqual([{ start: 1, end: 2, replacement: ['B'] }])
    const base = Array.from({ length: 520 }, (_, index) => 'base-' + index).join('\n')
    const remote = Array.from({ length: 520 }, (_, index) => 'remote-' + index).join('\n')
    expect(mergeThreeWay(base, base, remote).status).toBe('manual_resolution_required')
  })
})

