// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearReadingPositions,
  clearRecentFiles,
  clearSessionState,
  DEFAULT_READER_SETTINGS,
  loadReaderPersistence,
  MAX_RECENT_FILES,
  recordRecentFile,
  READER_STORAGE_KEYS,
  removeRecentFile,
  saveReaderSettings,
  saveReadingPositions,
  saveRecentFiles,
  saveSessionState,
} from './preferences'
import type { ReaderSettingsV1 } from './preferences'

describe('Reader 本地偏好与会话存储', () => {
  beforeEach(() => localStorage.clear())

  it('新安装使用规定默认值，并迁移旧主题偏好', () => {
    localStorage.setItem(READER_STORAGE_KEYS.legacyTheme, 'dark')
    const loaded = loadReaderPersistence(localStorage)
    expect(loaded.settings).toEqual({ ...DEFAULT_READER_SETTINGS, theme: 'dark' })
    expect(loaded.migratedSettings).toBe(true)
    expect(loaded.session).toBeNull()
    expect(loaded.recents).toEqual([])
    expect(loaded.positions.items).toEqual({})
    expect(loaded.settings.readingWidth).toBe('wide')
    expect(loaded.settings.doubleClickToClose).toBe(true)
  })

  it('兼容已有宽度偏好，并为旧设置补上双击关闭默认值', () => {
    localStorage.setItem(READER_STORAGE_KEYS.settings, JSON.stringify({
      schemaVersion: 1, theme: 'dark', fontSizePx: 18, readingWidth: 'standard', restoreTabs: false, rememberPosition: false,
    }))
    expect(loadReaderPersistence(localStorage).settings).toEqual({
      schemaVersion: 1, theme: 'dark', fontSizePx: 18, readingWidth: 'standard', restoreTabs: false, rememberPosition: false, doubleClickToClose: true,
    })
  })

  it('将旧版缩放偏好迁移为正文基准字号', () => {
    localStorage.setItem(READER_STORAGE_KEYS.legacyZoom, '120')
    expect(loadReaderPersistence(localStorage).settings.fontSizePx).toBe(19)
  })

  it('设置校验字号范围、主题、宽度与布尔开关', () => {
    localStorage.setItem(READER_STORAGE_KEYS.settings, JSON.stringify({
      schemaVersion: 1, theme: 'neon', fontSizePx: 32.4, readingWidth: 'giant', restoreTabs: false,
    }))
    expect(loadReaderPersistence(localStorage).settings).toEqual({
      schemaVersion: 1, theme: 'system', fontSizePx: 24, readingWidth: 'wide', restoreTabs: false, rememberPosition: true, doubleClickToClose: true,
    })
    const belowMin: ReaderSettingsV1 = { ...DEFAULT_READER_SETTINGS, fontSizePx: 3 }
    expect(saveReaderSettings(localStorage, belowMin)).toBe(true)
    expect(loadReaderPersistence(localStorage).settings.fontSizePx).toBe(12)
  })

  it('损坏设置会安全备份并回退，不暴露原始内容', () => {
    localStorage.setItem(READER_STORAGE_KEYS.settings, '{malformed private-like path')
    const loaded = loadReaderPersistence(localStorage)
    expect(loaded.settings).toEqual(DEFAULT_READER_SETTINGS)
    expect(loaded.warnings.join(' ')).toContain('已使用安全默认值')
    expect(localStorage.getItem(READER_STORAGE_KEYS.settings)).toBeNull()
    expect(localStorage.getItem(READER_STORAGE_KEYS.settingsBackup)).toBe('{malformed private-like path')
  })

  it('会话按文档扩展名去重，并把无效活动路径回退到最后一项', () => {
    expect(saveSessionState(localStorage, {
      schemaVersion: 1,
      tabPaths: ['/tmp/a.md', '/tmp/a.md', '/tmp/ignore.txt', '/tmp/b.markdown'],
      activePath: '/tmp/deleted.md',
      updatedAt: 100,
    })).toBe(true)
    expect(loadReaderPersistence(localStorage).session).toEqual({
      schemaVersion: 1, tabPaths: ['/tmp/a.md', '/tmp/b.markdown'], activePath: '/tmp/b.markdown', updatedAt: 100,
    })
    expect(clearSessionState(localStorage)).toBe(true)
    expect(loadReaderPersistence(localStorage).session).toBeNull()
  })

  it('最近文件按规范路径去重、排序并限制为 20 项，可独立清空', () => {
    let recents = Array.from({ length: 25 }, (_, index) => ({ path: `/tmp/${index}.md`, openedAt: index }))
    recents = recordRecentFile(recents, '/tmp/0.md', 50)
    expect(recents).toHaveLength(MAX_RECENT_FILES)
    expect(recents[0]).toEqual({ path: '/tmp/0.md', openedAt: 50 })
    expect(recents.filter(item => item.path === '/tmp/0.md')).toHaveLength(1)
    expect(removeRecentFile(recents, '/tmp/0.md').some(item => item.path === '/tmp/0.md')).toBe(false)
    expect(saveRecentFiles(localStorage, recents)).toBe(true)
    expect(loadReaderPersistence(localStorage).recents).toHaveLength(MAX_RECENT_FILES)
    expect(clearRecentFiles(localStorage)).toBe(true)
    expect(loadReaderPersistence(localStorage).recents).toEqual([])
  })

  it('位置记录校验比例并与会话、最近文件分开清理', () => {
    const positions = { schemaVersion: 1 as const, items: {
      '/tmp/a.md': { path: '/tmp/a.md', headingId: 'section', scrollRatio: 2, scrollTop: -1, updatedAt: 5 },
    } }
    localStorage.setItem(READER_STORAGE_KEYS.positions, JSON.stringify(positions))
    saveSessionState(localStorage, { schemaVersion: 1, tabPaths: ['/tmp/a.md'], activePath: '/tmp/a.md', updatedAt: 5 })
    saveRecentFiles(localStorage, [{ path: '/tmp/a.md', openedAt: 5 }])
    const loaded = loadReaderPersistence(localStorage)
    expect(loaded.positions.items['/tmp/a.md']).toMatchObject({ scrollRatio: 1, scrollTop: 0, headingId: 'section' })
    expect(clearReadingPositions(localStorage)).toBe(true)
    expect(loadReaderPersistence(localStorage).positions.items).toEqual({})
    expect(loadReaderPersistence(localStorage).session).not.toBeNull()
    expect(loadReaderPersistence(localStorage).recents).toHaveLength(1)
    expect(saveReadingPositions(localStorage, { schemaVersion: 1, items: {} })).toBe(true)
  })

  it('存储不可用时返回失败而不抛出', () => {
    const unavailable = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    expect(loadReaderPersistence(unavailable).settings).toEqual(DEFAULT_READER_SETTINGS)
    expect(saveReaderSettings(unavailable, DEFAULT_READER_SETTINGS)).toBe(false)
    expect(clearSessionState(unavailable)).toBe(false)
  })
})
