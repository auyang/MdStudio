export type ThemePreference = 'system' | 'light' | 'dark'
export type ReadingWidth = 'compact' | 'standard' | 'wide' | 'fit'
export type AppLocale = 'en' | 'zh-CN' | 'ja'

export type ReaderSettingsV1 = {
  schemaVersion: 1
  theme: ThemePreference
  fontSizePx: number
  readingWidth: ReadingWidth
  restoreTabs: boolean
  rememberPosition: boolean
  doubleClickToClose: boolean
  locale?: AppLocale
}

export type SessionStateV1 = {
  schemaVersion: 1
  tabPaths: string[]
  activePath: string | null
  updatedAt: number
}

export type RecentFileV1 = { path: string; openedAt: number }

export type ReadingPositionV1 = {
  path: string
  headingId?: string
  scrollRatio: number
  scrollTop: number
  updatedAt: number
}

export type ReadingPositionsV1 = { schemaVersion: 1; items: Record<string, ReadingPositionV1> }

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const READER_STORAGE_KEYS = {
  settings: 'mdstudio-reader-settings-v1',
  session: 'mdstudio-reader-session-v1',
  recents: 'mdstudio-reader-recents-v1',
  positions: 'mdstudio-reader-positions-v1',
  settingsBackup: 'mdstudio-reader-settings-v1.corrupt-backup',
  legacyTheme: 'mdstudio-reader-theme',
  legacyZoom: 'mdstudio-reader-zoom',
} as const

export const DEFAULT_READER_SETTINGS: ReaderSettingsV1 = {
  schemaVersion: 1,
  theme: 'system',
  fontSizePx: 16,
  readingWidth: 'wide',
  restoreTabs: true,
  rememberPosition: true,
  doubleClickToClose: true,
}

export const READING_WIDTH_PX: Record<Exclude<ReadingWidth, 'fit'>, number> = {
  compact: 720,
  standard: 820,
  wide: 980,
}

export const MAX_RECENT_FILES = 20

type ReaderPersistenceLoad = {
  settings: ReaderSettingsV1
  session: SessionStateV1 | null
  recents: RecentFileV1[]
  positions: ReadingPositionsV1
  warnings: string[]
  migratedSettings: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  return JSON.parse(raw) as unknown
}

function safelyRead(storage: StorageLike, key: string, warnings: string[]): unknown {
  try {
    return parseJson(storage.getItem(key))
  } catch {
    warnings.push(`本地${labelForKey(key)}损坏，已使用安全默认值。`)
    try {
      const raw = storage.getItem(key)
      if (key === READER_STORAGE_KEYS.settings && raw && raw.length <= 64_000 && !storage.getItem(READER_STORAGE_KEYS.settingsBackup)) {
        storage.setItem(READER_STORAGE_KEYS.settingsBackup, raw)
      }
      storage.removeItem(key)
    } catch {
      // 存储不可写时保留内存默认值，并由设置界面显示持久化错误。
    }
    return null
  }
}

function labelForKey(key: string): string {
  if (key === READER_STORAGE_KEYS.settings) return '阅读设置'
  if (key === READER_STORAGE_KEYS.session) return '恢复会话'
  if (key === READER_STORAGE_KEYS.recents) return '最近文件列表'
  return '阅读位置记录'
}

function normalizeSettings(value: unknown): ReaderSettingsV1 | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  const theme: ThemePreference = value.theme === 'light' || value.theme === 'dark' || value.theme === 'system'
    ? value.theme
    : DEFAULT_READER_SETTINGS.theme
  const fontSize = typeof value.fontSizePx === 'number' && Number.isFinite(value.fontSizePx)
    ? Math.min(24, Math.max(12, Math.round(value.fontSizePx)))
    : DEFAULT_READER_SETTINGS.fontSizePx
  const readingWidth: ReadingWidth = value.readingWidth === 'compact' || value.readingWidth === 'wide' || value.readingWidth === 'standard' || value.readingWidth === 'fit'
    ? value.readingWidth
    : DEFAULT_READER_SETTINGS.readingWidth
  return {
    schemaVersion: 1,
    theme,
    fontSizePx: fontSize,
    readingWidth,
    restoreTabs: typeof value.restoreTabs === 'boolean' ? value.restoreTabs : DEFAULT_READER_SETTINGS.restoreTabs,
    rememberPosition: typeof value.rememberPosition === 'boolean' ? value.rememberPosition : DEFAULT_READER_SETTINGS.rememberPosition,
    doubleClickToClose: typeof value.doubleClickToClose === 'boolean' ? value.doubleClickToClose : DEFAULT_READER_SETTINGS.doubleClickToClose,
    ...(value.locale === 'en' || value.locale === 'zh-CN' || value.locale === 'ja' ? { locale: value.locale } : {}),
  }
}

function isMarkdownPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 4096 && /\.(md|markdown)$/i.test(path)
}

export function loadReaderPersistence(storage: StorageLike): ReaderPersistenceLoad {
  const warnings: string[] = []
  const rawSettings = safelyRead(storage, READER_STORAGE_KEYS.settings, warnings)
  let settings = normalizeSettings(rawSettings)
  let migratedSettings = false
  if (!settings) {
    if (rawSettings !== null) {
      warnings.push('阅读设置版本不兼容，已回退为默认值。')
      try {
        const raw = storage.getItem(READER_STORAGE_KEYS.settings)
        if (raw && raw.length <= 64_000 && !storage.getItem(READER_STORAGE_KEYS.settingsBackup)) {
          storage.setItem(READER_STORAGE_KEYS.settingsBackup, raw)
        }
        storage.removeItem(READER_STORAGE_KEYS.settings)
      } catch {
        // 保留内存默认值。
      }
    }
    let legacyTheme: ThemePreference = 'system'
    let legacyFontSize = DEFAULT_READER_SETTINGS.fontSizePx
    try {
      const value = storage.getItem(READER_STORAGE_KEYS.legacyTheme)
      if (value === 'light' || value === 'dark' || value === 'system') legacyTheme = value
      const legacyZoom = Number(storage.getItem(READER_STORAGE_KEYS.legacyZoom))
      if (Number.isFinite(legacyZoom) && legacyZoom >= 85 && legacyZoom <= 140) {
        legacyFontSize = Math.min(24, Math.max(12, Math.round(16 * legacyZoom / 100)))
      }
    } catch {
      warnings.push('无法读取旧版主题偏好，已使用系统主题。')
    }
    settings = { ...DEFAULT_READER_SETTINGS, theme: legacyTheme, fontSizePx: legacyFontSize }
    migratedSettings = true
  }

  const rawSession = safelyRead(storage, READER_STORAGE_KEYS.session, warnings)
  let session: SessionStateV1 | null = null
  if (isRecord(rawSession) && rawSession.schemaVersion === 1 && Array.isArray(rawSession.tabPaths)) {
    const tabPaths = [...new Set(rawSession.tabPaths.filter(isMarkdownPath))]
    const activePath = isMarkdownPath(rawSession.activePath) && tabPaths.includes(rawSession.activePath)
      ? rawSession.activePath
      : tabPaths.at(-1) ?? null
    session = { schemaVersion: 1, tabPaths, activePath, updatedAt: validTimestamp(rawSession.updatedAt) }
  } else if (rawSession !== null) {
    warnings.push('恢复会话格式无效，已跳过会话恢复。')
    try { storage.removeItem(READER_STORAGE_KEYS.session) } catch { /* 只跳过恢复，不阻止阅读。 */ }
  }

  const rawRecents = safelyRead(storage, READER_STORAGE_KEYS.recents, warnings)
  let recents: RecentFileV1[] = []
  if (isRecord(rawRecents) && rawRecents.schemaVersion === 1 && Array.isArray(rawRecents.files)) {
    const byPath = new Map<string, RecentFileV1>()
    for (const entry of rawRecents.files) {
      if (!isRecord(entry) || !isMarkdownPath(entry.path)) continue
      const item = { path: entry.path, openedAt: validTimestamp(entry.openedAt) }
      const existing = byPath.get(item.path)
      if (!existing || item.openedAt > existing.openedAt) byPath.set(item.path, item)
    }
    recents = [...byPath.values()].sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_RECENT_FILES)
  } else if (rawRecents !== null) {
    warnings.push('最近文件列表格式无效，已清空列表元数据。')
    try { storage.removeItem(READER_STORAGE_KEYS.recents) } catch { /* 内存中为空即可。 */ }
  }

  const rawPositions = safelyRead(storage, READER_STORAGE_KEYS.positions, warnings)
  const items: Record<string, ReadingPositionV1> = {}
  if (isRecord(rawPositions) && rawPositions.schemaVersion === 1 && isRecord(rawPositions.items)) {
    for (const [path, value] of Object.entries(rawPositions.items)) {
      if (!isMarkdownPath(path) || !isRecord(value)) continue
      const ratio = typeof value.scrollRatio === 'number' && Number.isFinite(value.scrollRatio)
        ? Math.min(1, Math.max(0, value.scrollRatio))
        : 0
      const scrollTop = typeof value.scrollTop === 'number' && Number.isFinite(value.scrollTop)
        ? Math.max(0, value.scrollTop)
        : 0
      items[path] = {
        path,
        ...(typeof value.headingId === 'string' && value.headingId.length <= 512 ? { headingId: value.headingId } : {}),
        scrollRatio: ratio,
        scrollTop,
        updatedAt: validTimestamp(value.updatedAt),
      }
    }
  } else if (rawPositions !== null) {
    warnings.push('阅读位置记录格式无效，已清空位置元数据。')
    try { storage.removeItem(READER_STORAGE_KEYS.positions) } catch { /* 内存中为空即可。 */ }
  }

  return { settings, session, recents, positions: { schemaVersion: 1, items }, warnings, migratedSettings }
}

function validTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function writeJson(storage: StorageLike, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function saveReaderSettings(storage: StorageLike, settings: ReaderSettingsV1): boolean {
  const normalized = normalizeSettings(settings)
  return normalized !== null && writeJson(storage, READER_STORAGE_KEYS.settings, normalized)
}

export function saveSessionState(storage: StorageLike, session: SessionStateV1): boolean {
  const tabPaths = [...new Set(session.tabPaths.filter(isMarkdownPath))]
  const activePath = session.activePath && tabPaths.includes(session.activePath) ? session.activePath : tabPaths.at(-1) ?? null
  return writeJson(storage, READER_STORAGE_KEYS.session, {
    schemaVersion: 1,
    tabPaths,
    activePath,
    updatedAt: validTimestamp(session.updatedAt),
  } satisfies SessionStateV1)
}

export function clearSessionState(storage: StorageLike): boolean {
  try { storage.removeItem(READER_STORAGE_KEYS.session); return true } catch { return false }
}

export function recordRecentFile(
  recents: RecentFileV1[],
  path: string,
  openedAt = Date.now(),
): RecentFileV1[] {
  if (!isMarkdownPath(path)) return recents
  return [{ path, openedAt: validTimestamp(openedAt) }, ...recents.filter(item => item.path !== path)]
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, MAX_RECENT_FILES)
}

export function saveRecentFiles(storage: StorageLike, recents: RecentFileV1[]): boolean {
  const unique = new Map<string, RecentFileV1>()
  for (const item of recents) {
    if (!isMarkdownPath(item.path)) continue
    const current = unique.get(item.path)
    if (!current || item.openedAt > current.openedAt) unique.set(item.path, item)
  }
  const files = [...unique.values()].sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_RECENT_FILES)
  return writeJson(storage, READER_STORAGE_KEYS.recents, { schemaVersion: 1, files })
}

export function removeRecentFile(recents: RecentFileV1[], path: string): RecentFileV1[] {
  return recents.filter(item => item.path !== path)
}

export function clearRecentFiles(storage: StorageLike): boolean {
  try { storage.removeItem(READER_STORAGE_KEYS.recents); return true } catch { return false }
}

export function saveReadingPositions(storage: StorageLike, positions: ReadingPositionsV1): boolean {
  return writeJson(storage, READER_STORAGE_KEYS.positions, positions)
}

export function clearReadingPositions(storage: StorageLike): boolean {
  try { storage.removeItem(READER_STORAGE_KEYS.positions); return true } catch { return false }
}
