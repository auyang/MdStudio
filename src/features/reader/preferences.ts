import { documentTypeFromPath } from '../documents/core/types'
import type { DocumentDescriptor } from '../documents/core/types'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ReadingWidth = 'compact' | 'standard' | 'wide' | 'fit'
export type AppLocale = 'en' | 'zh-CN' | 'ja'
export type OfdFallbackFont = 'auto' | 'source-han-sans' | 'source-han-serif'

export type ReaderSettingsV1 = {
  schemaVersion: 1
  theme: ThemePreference
  fontSizePx: number
  editorFontSizePx: number
  readingWidth: ReadingWidth
  restoreTabs: boolean
  rememberPosition: boolean
  doubleClickToClose: boolean
  ofdSystemFontFallback: boolean
  ofdFallbackFont: OfdFallbackFont
  locale?: AppLocale
}

export type SessionStateV1 = {
  schemaVersion: 1
  tabPaths: string[]
  activePath: string | null
  updatedAt: number
  documentTypes?: Record<string, 'markdown' | 'pdf' | 'ofd'>
}

export type RecentFileV1 = { path: string; openedAt: number; documentType?: 'markdown' | 'pdf' | 'ofd' }

export type ReadingPositionV1 = {
  path: string
  headingId?: string
  scrollRatio: number
  scrollTop: number
  updatedAt: number
}

export type ReadingPositionsV1 = { schemaVersion: 1; items: Record<string, ReadingPositionV1> }

type SessionStateV2 = {
  schemaVersion: 2
  documents: DocumentDescriptor[]
  activePath: string | null
  updatedAt: number
}

type RecentFileV2 = DocumentDescriptor & { openedAt: number }
type ReadingPositionV2 = ReadingPositionV1 & { documentType: 'markdown' }
export type PdfReadingPosition = { path: string; page: number; scale: number; rotation: number; updatedAt: number }
export type OfdReadingPosition = PdfReadingPosition
type PdfReadingPositionV2 = PdfReadingPosition & { documentType: 'pdf' }
type OfdReadingPositionV2 = OfdReadingPosition & { documentType: 'ofd' }
type ReaderPersistenceV2 = {
  schemaVersion: 2
  settings: Omit<ReaderSettingsV1, 'schemaVersion'> & { schemaVersion: 2 }
  session: SessionStateV2 | null
  recents: RecentFileV2[]
  positions: { schemaVersion: 2; items: Record<string, ReadingPositionV2> }
  pdfPositions: { schemaVersion: 1; items: Record<string, PdfReadingPositionV2> }
  ofdPositions: { schemaVersion: 1; items: Record<string, OfdReadingPositionV2> }
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const READER_STORAGE_KEYS = {
  settings: 'mdstudio-reader-settings-v1',
  session: 'mdstudio-reader-session-v1',
  recents: 'mdstudio-reader-recents-v1',
  positions: 'mdstudio-reader-positions-v1',
  persistenceV2: 'mdstudio-reader-persistence-v2',
  persistenceV2Backup: 'mdstudio-reader-persistence-v2.corrupt-backup',
  settingsBackup: 'mdstudio-reader-settings-v1.corrupt-backup',
  legacyTheme: 'mdstudio-reader-theme',
  legacyZoom: 'mdstudio-reader-zoom',
} as const

export const DEFAULT_READER_SETTINGS: ReaderSettingsV1 = {
  schemaVersion: 1,
  theme: 'system',
  fontSizePx: 16,
  editorFontSizePx: 14,
  readingWidth: 'wide',
  restoreTabs: true,
  rememberPosition: true,
  doubleClickToClose: true,
  ofdSystemFontFallback: true,
  ofdFallbackFont: 'auto',
}

export const READING_WIDTH_PX: Record<Exclude<ReadingWidth, 'fit'>, number> = {
  compact: 720,
  standard: 820,
  wide: 980,
}

export const MAX_RECENT_FILES = 20

export type ReaderPersistenceLoad = {
  settings: ReaderSettingsV1
  session: SessionStateV1 | null
  recents: RecentFileV1[]
  positions: ReadingPositionsV1
  pdfPositions: Record<string, PdfReadingPosition>
  ofdPositions: Record<string, OfdReadingPosition>
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
      const backupKey = key === READER_STORAGE_KEYS.settings
        ? READER_STORAGE_KEYS.settingsBackup
        : key === READER_STORAGE_KEYS.persistenceV2 ? READER_STORAGE_KEYS.persistenceV2Backup : undefined
      if (backupKey && raw && raw.length <= 256_000 && !storage.getItem(backupKey)) storage.setItem(backupKey, raw)
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
  if (key === READER_STORAGE_KEYS.persistenceV2) return '文档阅读状态'
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
  const editorFontSize = typeof value.editorFontSizePx === 'number' && Number.isFinite(value.editorFontSizePx)
    ? Math.min(24, Math.max(10, Math.round(value.editorFontSizePx)))
    : DEFAULT_READER_SETTINGS.editorFontSizePx
  const readingWidth: ReadingWidth = value.readingWidth === 'compact' || value.readingWidth === 'wide' || value.readingWidth === 'standard' || value.readingWidth === 'fit'
    ? value.readingWidth
    : DEFAULT_READER_SETTINGS.readingWidth
  return {
    schemaVersion: 1,
    theme,
    fontSizePx: fontSize,
    editorFontSizePx: editorFontSize,
    readingWidth,
    restoreTabs: typeof value.restoreTabs === 'boolean' ? value.restoreTabs : DEFAULT_READER_SETTINGS.restoreTabs,
    rememberPosition: typeof value.rememberPosition === 'boolean' ? value.rememberPosition : DEFAULT_READER_SETTINGS.rememberPosition,
    doubleClickToClose: typeof value.doubleClickToClose === 'boolean' ? value.doubleClickToClose : DEFAULT_READER_SETTINGS.doubleClickToClose,
    ofdSystemFontFallback: typeof value.ofdSystemFontFallback === 'boolean' ? value.ofdSystemFontFallback : DEFAULT_READER_SETTINGS.ofdSystemFontFallback,
    ofdFallbackFont: value.ofdFallbackFont === 'source-han-sans' || value.ofdFallbackFont === 'source-han-serif' || value.ofdFallbackFont === 'auto'
      ? value.ofdFallbackFont
      : DEFAULT_READER_SETTINGS.ofdFallbackFont,
    ...(value.locale === 'en' || value.locale === 'zh-CN' || value.locale === 'ja' ? { locale: value.locale } : {}),
  }
}

function isMarkdownPath(path: unknown): path is string {
  return typeof path === 'string'
    && path.length > 0
    && path.length <= 4096
    && documentTypeFromPath(path) === 'markdown'
}

function isSupportedDocumentPath(path: unknown): path is string {
  return typeof path === 'string'
    && path.length > 0
    && path.length <= 4096
    && documentTypeFromPath(path) !== null
}

function descriptorForPath(path: string, requestedType?: 'markdown' | 'pdf' | 'ofd'): DocumentDescriptor {
  const type = requestedType ?? documentTypeFromPath(path)
  return {
    documentType: type ?? 'markdown',
    canonicalPath: path,
    displayName: path.split(/[\\/]/).filter(Boolean).at(-1) || path,
  }
}

function normalizePdfPosition(path: string, value: unknown): PdfReadingPosition | null {
  if (!isSupportedDocumentPath(path) || documentTypeFromPath(path) !== 'pdf' || !isRecord(value)) return null
  const page = typeof value.page === 'number' && Number.isFinite(value.page) ? Math.max(1, Math.floor(value.page)) : 1
  const scale = typeof value.scale === 'number' && Number.isFinite(value.scale) ? Math.min(3, Math.max(0.5, value.scale)) : 1
  const rotation = typeof value.rotation === 'number' && Number.isFinite(value.rotation)
    ? ((Math.round(value.rotation / 90) * 90) % 360 + 360) % 360
    : 0
  return { path, page, scale, rotation, updatedAt: validTimestamp(value.updatedAt) }
}

function normalizeOfdPosition(path: string, value: unknown): OfdReadingPosition | null {
  if (!isSupportedDocumentPath(path) || documentTypeFromPath(path) !== 'ofd' || !isRecord(value)) return null
  const page = typeof value.page === 'number' && Number.isFinite(value.page) ? Math.max(1, Math.floor(value.page)) : 1
  const scale = typeof value.scale === 'number' && Number.isFinite(value.scale) ? Math.min(3, Math.max(0.25, value.scale)) : 1
  const rotation = typeof value.rotation === 'number' && Number.isFinite(value.rotation)
    ? ((Math.round(value.rotation / 90) * 90) % 360 + 360) % 360
    : 0
  return { path, page, scale, rotation, updatedAt: validTimestamp(value.updatedAt) }
}

function validTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function normalizePosition(path: string, value: unknown): ReadingPositionV1 | null {
  if (!isMarkdownPath(path) || !isRecord(value)) return null
  const ratio = typeof value.scrollRatio === 'number' && Number.isFinite(value.scrollRatio)
    ? Math.min(1, Math.max(0, value.scrollRatio))
    : 0
  const scrollTop = typeof value.scrollTop === 'number' && Number.isFinite(value.scrollTop)
    ? Math.max(0, value.scrollTop)
    : 0
  return {
    path,
    ...(typeof value.headingId === 'string' && value.headingId.length <= 512 ? { headingId: value.headingId } : {}),
    scrollRatio: ratio,
    scrollTop,
    updatedAt: validTimestamp(value.updatedAt),
  }
}

function readV1Persistence(storage: StorageLike): ReaderPersistenceLoad {
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
      const position = normalizePosition(path, value)
      if (position) items[path] = position
    }
  } else if (rawPositions !== null) {
    warnings.push('阅读位置记录格式无效，已清空位置元数据。')
    try { storage.removeItem(READER_STORAGE_KEYS.positions) } catch { /* 内存中为空即可。 */ }
  }

  return { settings, session, recents, positions: { schemaVersion: 1, items }, pdfPositions: {}, ofdPositions: {}, warnings, migratedSettings }
}

function toV2(value: ReaderPersistenceLoad): ReaderPersistenceV2 {
  return {
    schemaVersion: 2,
    settings: { ...value.settings, schemaVersion: 2 },
    session: value.session ? {
      schemaVersion: 2,
      documents: value.session.tabPaths.map(path => descriptorForPath(path, value.session?.documentTypes?.[path])),
      activePath: value.session.activePath,
      updatedAt: value.session.updatedAt,
    } : null,
    recents: value.recents.map(file => ({ ...descriptorForPath(file.path, file.documentType), openedAt: file.openedAt })),
    positions: {
      schemaVersion: 2,
      items: Object.fromEntries(Object.entries(value.positions.items).map(([path, position]) => [path, { ...position, documentType: 'markdown' as const }])),
    },
    pdfPositions: {
      schemaVersion: 1,
      items: Object.fromEntries(Object.entries(value.pdfPositions).map(([path, position]) => [path, { ...position, documentType: 'pdf' as const }])),
    },
    ofdPositions: {
      schemaVersion: 1,
      items: Object.fromEntries(Object.entries(value.ofdPositions).map(([path, position]) => [path, { ...position, documentType: 'ofd' as const }])),
    },
  }
}

function fromV2(value: unknown, warnings: string[]): ReaderPersistenceLoad | null {
  if (!isRecord(value) || value.schemaVersion !== 2 || !isRecord(value.settings) || !Array.isArray(value.recents) || !isRecord(value.positions)) return null
  const settings = normalizeSettings({ ...value.settings, schemaVersion: 1 })
  if (!settings || value.positions.schemaVersion !== 2 || !isRecord(value.positions.items)) return null

  let session: SessionStateV1 | null = null
  if (value.session === null) {
    session = null
  } else if (isRecord(value.session) && value.session.schemaVersion === 2 && Array.isArray(value.session.documents)) {
    const paths = value.session.documents.flatMap((item): string[] => {
      if (!isRecord(item) || !['markdown', 'pdf', 'ofd'].includes(String(item.documentType)) || !isSupportedDocumentPath(item.canonicalPath)) return []
      if (documentTypeFromPath(item.canonicalPath) !== item.documentType) return []
      return [item.canonicalPath]
    })
    const tabPaths = [...new Set(paths)]
    const activePath = isSupportedDocumentPath(value.session.activePath) && tabPaths.includes(value.session.activePath)
      ? value.session.activePath
      : tabPaths.at(-1) ?? null
    session = { schemaVersion: 1, tabPaths, activePath, updatedAt: validTimestamp(value.session.updatedAt) }
  } else {
    warnings.push('V2 恢复会话格式无效，已跳过会话恢复。')
  }

  const byPath = new Map<string, RecentFileV1>()
  for (const entry of value.recents) {
    if (!isRecord(entry) || !['markdown', 'pdf', 'ofd'].includes(String(entry.documentType)) || !isSupportedDocumentPath(entry.canonicalPath)) continue
    if (documentTypeFromPath(entry.canonicalPath) !== entry.documentType) continue
    byPath.set(entry.canonicalPath, {
      path: entry.canonicalPath,
      ...(entry.documentType !== 'markdown' ? { documentType: entry.documentType as 'pdf' | 'ofd' } : {}),
      openedAt: validTimestamp(entry.openedAt),
    })
  }
  const recents = [...byPath.values()].sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_RECENT_FILES)
  const items: Record<string, ReadingPositionV1> = {}
  for (const [path, entry] of Object.entries(value.positions.items)) {
    if (!isRecord(entry) || entry.documentType !== 'markdown') continue
    const position = normalizePosition(path, entry)
    if (position) items[path] = position
  }
  const pdfPositionItems = isRecord(value.pdfPositions)
    && value.pdfPositions.schemaVersion === 1
    && isRecord(value.pdfPositions.items)
    ? value.pdfPositions.items
    : {}
  const pdfPositions: Record<string, PdfReadingPosition> = {}
  for (const [path, entry] of Object.entries(pdfPositionItems)) {
    if (!isRecord(entry) || entry.documentType !== 'pdf') continue
    const position = normalizePdfPosition(path, entry)
    if (position) pdfPositions[path] = position
  }
  const ofdPositionItems = isRecord(value.ofdPositions)
    && value.ofdPositions.schemaVersion === 1
    && isRecord(value.ofdPositions.items)
    ? value.ofdPositions.items
    : {}
  const ofdPositions: Record<string, OfdReadingPosition> = {}
  for (const [path, entry] of Object.entries(ofdPositionItems)) {
    if (!isRecord(entry) || entry.documentType !== 'ofd') continue
    const position = normalizeOfdPosition(path, entry)
    if (position) ofdPositions[path] = position
  }
  return {
    settings,
    session,
    recents,
    positions: { schemaVersion: 1, items },
    pdfPositions,
    ofdPositions,
    warnings,
    migratedSettings: false,
  }
}

function currentV2(storage: StorageLike): ReaderPersistenceV2 {
  try {
    const parsed = parseJson(storage.getItem(READER_STORAGE_KEYS.persistenceV2))
    const normalized = fromV2(parsed, [])
    if (normalized) return toV2(normalized)
  } catch {
    // 由 loadReaderPersistence 负责备份/报告损坏数据；写入路径可从 V1 恢复。
  }
  return toV2(readV1Persistence(storage))
}

function writeV2(storage: StorageLike, next: ReaderPersistenceV2): boolean {
  return writeJson(storage, READER_STORAGE_KEYS.persistenceV2, next)
}

function commitV2(storage: StorageLike, next: ReaderPersistenceV2, mirrorV1: () => boolean): boolean {
  let previousV2: string | null
  try {
    previousV2 = storage.getItem(READER_STORAGE_KEYS.persistenceV2)
  } catch {
    return false
  }
  if (!writeV2(storage, next)) return false
  if (mirrorV1()) return true
  try {
    if (previousV2 === null) storage.removeItem(READER_STORAGE_KEYS.persistenceV2)
    else storage.setItem(READER_STORAGE_KEYS.persistenceV2, previousV2)
  } catch {
    // V1 兼容写入失败时尽力回滚 V2，避免两份数据分叉。
  }
  return false
}

function writeJson(storage: StorageLike, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadReaderPersistence(storage: StorageLike): ReaderPersistenceLoad {
  const warnings: string[] = []
  const rawV2 = safelyRead(storage, READER_STORAGE_KEYS.persistenceV2, warnings)
  if (rawV2 !== null) {
    const loaded = fromV2(rawV2, warnings)
    if (loaded) return loaded
    warnings.push('文档阅读状态版本不兼容，已从 V1 数据恢复。')
    try {
      const raw = storage.getItem(READER_STORAGE_KEYS.persistenceV2)
      if (raw && raw.length <= 256_000 && !storage.getItem(READER_STORAGE_KEYS.persistenceV2Backup)) {
        storage.setItem(READER_STORAGE_KEYS.persistenceV2Backup, raw)
      }
    } catch {
      // 备份失败不阻止从仍保留的 V1 键恢复。
    }
  }
  const legacy = readV1Persistence(storage)
  warnings.push(...legacy.warnings)
  if (!writeV2(storage, toV2(legacy))) warnings.push('V2 文档状态迁移未能保存；V1 数据仍保留。')
  return { ...legacy, warnings }
}

export function saveReaderSettings(storage: StorageLike, settings: ReaderSettingsV1): boolean {
  const normalized = normalizeSettings(settings)
  if (!normalized) return false
  const state = currentV2(storage)
  // V1 镜像保留给旧版本回滚；V2 是当前读取的权威记录。
  return commitV2(storage, { ...state, settings: { ...normalized, schemaVersion: 2 } }, () =>
    writeJson(storage, READER_STORAGE_KEYS.settings, normalized))
}

export function saveSessionState(storage: StorageLike, session: SessionStateV1): boolean {
  const tabPaths = [...new Set(session.tabPaths.filter(isSupportedDocumentPath))]
  const documentTypes = Object.fromEntries(tabPaths.map(path => [path, session.documentTypes?.[path] ?? documentTypeFromPath(path) ?? 'markdown']))
  const activePath = session.activePath && tabPaths.includes(session.activePath) ? session.activePath : tabPaths.at(-1) ?? null
  const normalized: SessionStateV1 = { schemaVersion: 1, tabPaths, activePath, documentTypes, updatedAt: validTimestamp(session.updatedAt) }
  const state = currentV2(storage)
  return commitV2(storage, { ...state, session: {
    schemaVersion: 2,
    documents: tabPaths.map(path => descriptorForPath(path, documentTypes[path])),
    activePath,
    updatedAt: normalized.updatedAt,
  } }, () => {
    const legacyPaths = tabPaths.filter(isMarkdownPath)
    const legacyActivePath = activePath && isMarkdownPath(activePath) ? activePath : legacyPaths.at(-1) ?? null
    return writeJson(storage, READER_STORAGE_KEYS.session, {
      schemaVersion: 1,
      tabPaths: legacyPaths,
      activePath: legacyActivePath,
      updatedAt: normalized.updatedAt,
    })
  })
}

export function clearSessionState(storage: StorageLike): boolean {
  const state = currentV2(storage)
  return commitV2(storage, { ...state, session: null }, () => {
    try { storage.removeItem(READER_STORAGE_KEYS.session); return true } catch { return false }
  })
}

export function recordRecentFile(
  recents: RecentFileV1[],
  path: string,
  openedAt = Date.now(),
): RecentFileV1[] {
  if (!isSupportedDocumentPath(path)) return recents
  const documentType = documentTypeFromPath(path)
  if (!documentType) return recents
  return [{ path, ...(documentType !== 'markdown' ? { documentType } : {}), openedAt: validTimestamp(openedAt) }, ...recents.filter(item => item.path !== path)]
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, MAX_RECENT_FILES)
}

export function saveRecentFiles(storage: StorageLike, recents: RecentFileV1[]): boolean {
  const unique = new Map<string, RecentFileV1>()
  for (const item of recents) {
    if (!isSupportedDocumentPath(item.path)) continue
    const current = unique.get(item.path)
    const normalized: RecentFileV1 = {
      ...item,
      documentType: item.documentType ?? documentTypeFromPath(item.path) ?? 'markdown',
    }
    if (!current || item.openedAt > current.openedAt) unique.set(item.path, normalized)
  }
  const files = [...unique.values()].sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_RECENT_FILES)
  const state = currentV2(storage)
  return commitV2(storage, { ...state, recents: files.map(file => ({ ...descriptorForPath(file.path, file.documentType), openedAt: file.openedAt })) }, () =>
    writeJson(storage, READER_STORAGE_KEYS.recents, { schemaVersion: 1, files: files.filter(file => isMarkdownPath(file.path)).map(({ path, openedAt }) => ({ path, openedAt })) }))
}

export function removeRecentFile(recents: RecentFileV1[], path: string): RecentFileV1[] {
  return recents.filter(item => item.path !== path)
}

export function clearRecentFiles(storage: StorageLike): boolean {
  const state = currentV2(storage)
  return commitV2(storage, { ...state, recents: [] }, () => {
    try { storage.removeItem(READER_STORAGE_KEYS.recents); return true } catch { return false }
  })
}

export function saveReadingPositions(storage: StorageLike, positions: ReadingPositionsV1): boolean {
  const items: Record<string, ReadingPositionV2> = {}
  for (const [path, value] of Object.entries(positions.items)) {
    const position = normalizePosition(path, value)
    if (position) items[path] = { ...position, documentType: 'markdown' }
  }
  const normalized = { schemaVersion: 2 as const, items }
  const state = currentV2(storage)
  return commitV2(storage, { ...state, positions: normalized }, () =>
    writeJson(storage, READER_STORAGE_KEYS.positions, { schemaVersion: 1, items: Object.fromEntries(Object.entries(items).map(([path, { documentType: _type, ...position }]) => [path, position])) }))
}

export function savePdfReadingPositions(storage: StorageLike, positions: Record<string, PdfReadingPosition>): boolean {
  const items: Record<string, PdfReadingPositionV2> = {}
  for (const [path, value] of Object.entries(positions)) {
    const position = normalizePdfPosition(path, value)
    if (position) items[path] = { ...position, documentType: 'pdf' }
  }
  const state = currentV2(storage)
  return commitV2(storage, { ...state, pdfPositions: { schemaVersion: 1, items } }, () => true)
}

export function saveOfdReadingPositions(storage: StorageLike, positions: Record<string, OfdReadingPosition>): boolean {
  const items: Record<string, OfdReadingPositionV2> = {}
  for (const [path, value] of Object.entries(positions)) {
    const position = normalizeOfdPosition(path, value)
    if (position) items[path] = { ...position, documentType: 'ofd' }
  }
  const state = currentV2(storage)
  return commitV2(storage, { ...state, ofdPositions: { schemaVersion: 1, items } }, () => true)
}

export function clearReadingPositions(storage: StorageLike): boolean {
  const state = currentV2(storage)
  return commitV2(storage, { ...state, positions: { schemaVersion: 2, items: {} }, pdfPositions: { schemaVersion: 1, items: {} }, ofdPositions: { schemaVersion: 1, items: {} } }, () => {
    try { storage.removeItem(READER_STORAGE_KEYS.positions); return true } catch { return false }
  })
}
