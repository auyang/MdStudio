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
  savePdfReadingPositions,
  saveOfdReadingPositions,
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
      schemaVersion: 1, theme: 'dark', fontSizePx: 18, editorFontSizePx: 14, readingWidth: 'standard', restoreTabs: false, rememberPosition: false, doubleClickToClose: true,
      ofdSystemFontFallback: true, ofdFallbackFont: 'auto',
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
      schemaVersion: 1, theme: 'system', fontSizePx: 24, editorFontSizePx: 14, readingWidth: 'wide', restoreTabs: false, rememberPosition: true, doubleClickToClose: true,
      ofdSystemFontFallback: true, ofdFallbackFont: 'auto',
    })
    const belowMin: ReaderSettingsV1 = { ...DEFAULT_READER_SETTINGS, fontSizePx: 3 }
    expect(saveReaderSettings(localStorage, belowMin)).toBe(true)
    expect(loadReaderPersistence(localStorage).settings.fontSizePx).toBe(12)
  })

  it('校验并持久化源码编辑器字号', () => {
    localStorage.setItem(READER_STORAGE_KEYS.settings, JSON.stringify({
      ...DEFAULT_READER_SETTINGS,
      editorFontSizePx: 30,
    }))
    expect(loadReaderPersistence(localStorage).settings.editorFontSizePx).toBe(24)
    expect(saveReaderSettings(localStorage, { ...DEFAULT_READER_SETTINGS, editorFontSizePx: 11 })).toBe(true)
    expect(loadReaderPersistence(localStorage).settings.editorFontSizePx).toBe(11)
  })

  it('持久化 OFD 系统字体替代开关与兜底风格', () => {
    const settings = {
      ...DEFAULT_READER_SETTINGS,
      ofdSystemFontFallback: false,
      ofdFallbackFont: 'source-han-serif' as const,
    }
    expect(saveReaderSettings(localStorage, settings)).toBe(true)
    expect(loadReaderPersistence(localStorage).settings).toEqual(settings)
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

  it('V2 会话、最近文件和页位置支持 PDF/OFD，同时保留 V1 Markdown 回滚镜像', () => {
    expect(saveSessionState(localStorage, {
      schemaVersion: 1,
      tabPaths: ['/tmp/readme.md', '/tmp/报告.pdf', '/tmp/电子票据.ofd'],
      activePath: '/tmp/电子票据.ofd',
      updatedAt: 300,
    })).toBe(true)
    const legacySession = JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.session) || 'null')
    expect(legacySession).toMatchObject({ tabPaths: ['/tmp/readme.md'], activePath: '/tmp/readme.md' })
    expect(loadReaderPersistence(localStorage).session?.tabPaths).toEqual(['/tmp/readme.md', '/tmp/报告.pdf', '/tmp/电子票据.ofd'])

    expect(saveRecentFiles(localStorage, [
      { path: '/tmp/readme.md', openedAt: 20 },
      { path: '/tmp/报告.pdf', openedAt: 30 },
      { path: '/tmp/电子票据.ofd', openedAt: 40 },
    ])).toBe(true)
    expect(loadReaderPersistence(localStorage).recents.map(item => item.path)).toEqual(['/tmp/电子票据.ofd', '/tmp/报告.pdf', '/tmp/readme.md'])

    expect(savePdfReadingPositions(localStorage, {
      '/tmp/报告.pdf': { path: '/tmp/报告.pdf', page: 999, scale: 5, rotation: 450, updatedAt: 40 },
    })).toBe(true)
    expect(loadReaderPersistence(localStorage).pdfPositions['/tmp/报告.pdf']).toEqual({
      path: '/tmp/报告.pdf', page: 999, scale: 3, rotation: 90, updatedAt: 40,
    })
    expect(saveOfdReadingPositions(localStorage, {
      '/tmp/电子票据.ofd': { path: '/tmp/电子票据.ofd', page: 6, scale: 0.1, rotation: -90, updatedAt: 41 },
    })).toBe(true)
    expect(loadReaderPersistence(localStorage).ofdPositions['/tmp/电子票据.ofd']).toEqual({
      path: '/tmp/电子票据.ofd', page: 6, scale: 0.25, rotation: 270, updatedAt: 41,
    })
    expect(clearReadingPositions(localStorage)).toBe(true)
    expect(loadReaderPersistence(localStorage).pdfPositions).toEqual({})
    expect(loadReaderPersistence(localStorage).ofdPositions).toEqual({})
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

  it('将 V1 状态迁移为带文档类型的 V2，并保留 V1 回滚副本', () => {
    const legacySettings = JSON.stringify({ schemaVersion: 1, theme: 'dark', fontSizePx: 17, readingWidth: 'wide', restoreTabs: true, rememberPosition: true, doubleClickToClose: true })
    const legacySession = JSON.stringify({ schemaVersion: 1, tabPaths: ['/docs/一.md'], activePath: '/docs/一.md', updatedAt: 42 })
    localStorage.setItem(READER_STORAGE_KEYS.settings, legacySettings)
    localStorage.setItem(READER_STORAGE_KEYS.session, legacySession)
    localStorage.setItem(READER_STORAGE_KEYS.recents, JSON.stringify({ schemaVersion: 1, files: [{ path: '/docs/一.md', openedAt: 41 }] }))
    localStorage.setItem(READER_STORAGE_KEYS.positions, JSON.stringify({ schemaVersion: 1, items: { '/docs/一.md': { path: '/docs/一.md', headingId: '标题', scrollRatio: 0.5, scrollTop: 120, updatedAt: 40 } } }))

    const loaded = loadReaderPersistence(localStorage)
    const v2 = JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.persistenceV2)!)
    expect(loaded.session?.tabPaths).toEqual(['/docs/一.md'])
    expect(loaded.positions.items['/docs/一.md']?.headingId).toBe('标题')
    expect(v2.schemaVersion).toBe(2)
    expect(v2.session.documents).toEqual([{ documentType: 'markdown', canonicalPath: '/docs/一.md', displayName: '一.md' }])
    expect(v2.recents[0].documentType).toBe('markdown')
    expect(v2.positions.items['/docs/一.md'].documentType).toBe('markdown')
    expect(localStorage.getItem(READER_STORAGE_KEYS.settings)).toBe(legacySettings)
    expect(localStorage.getItem(READER_STORAGE_KEYS.session)).toBe(legacySession)
  })

  it('保存 V2 后同步更新 V1 兼容键，旧版本仍能恢复 Markdown 状态', () => {
    const settings = { ...DEFAULT_READER_SETTINGS, theme: 'dark' as const, locale: 'ja' as const }
    const session = { schemaVersion: 1 as const, tabPaths: ['/docs/readme.markdown'], activePath: '/docs/readme.markdown', updatedAt: 70 }
    const recents = [{ path: '/docs/readme.markdown', openedAt: 71 }]
    const positions = { schemaVersion: 1 as const, items: {
      '/docs/readme.markdown': { path: '/docs/readme.markdown', headingId: 'intro', scrollRatio: 0.4, scrollTop: 240, updatedAt: 72 },
    } }

    expect(saveReaderSettings(localStorage, settings)).toBe(true)
    expect(saveSessionState(localStorage, session)).toBe(true)
    expect(saveRecentFiles(localStorage, recents)).toBe(true)
    expect(saveReadingPositions(localStorage, positions)).toBe(true)

    expect(JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.settings)!)).toMatchObject({ schemaVersion: 1, theme: 'dark', locale: 'ja' })
    expect(JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.session)!)).toEqual(session)
    expect(JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.recents)!)).toEqual({ schemaVersion: 1, files: recents })
    expect(JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.positions)!)).toEqual(positions)

    const v2 = JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.persistenceV2)!)
    expect(v2.schemaVersion).toBe(2)
    expect(v2.positions.items['/docs/readme.markdown'].documentType).toBe('markdown')
  })

  it('损坏的 V2 数据会备份并从保留的 V1 状态恢复', () => {
    localStorage.setItem(READER_STORAGE_KEYS.settings, JSON.stringify({ ...DEFAULT_READER_SETTINGS, theme: 'light' }))
    localStorage.setItem(READER_STORAGE_KEYS.persistenceV2, '{broken v2')
    const loaded = loadReaderPersistence(localStorage)
    expect(loaded.settings.theme).toBe('light')
    expect(localStorage.getItem(READER_STORAGE_KEYS.persistenceV2Backup)).toBe('{broken v2')
    expect(JSON.parse(localStorage.getItem(READER_STORAGE_KEYS.persistenceV2)!).schemaVersion).toBe(2)
    expect(localStorage.getItem(READER_STORAGE_KEYS.settings)).not.toBeNull()
  })
})
