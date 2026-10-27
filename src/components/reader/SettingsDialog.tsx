import { getVersion } from '@tauri-apps/api/app'
import { BookOpen, Clock3, Info, Settings2, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ReaderSettingsV1, RecentFileV1, ReadingWidth, ThemePreference } from '../../features/reader/preferences'
import { DEFAULT_READER_SETTINGS, READING_WIDTH_PX } from '../../features/reader/preferences'
import { useI18n } from '../../features/i18n'

export type SettingsSection = 'appearance' | 'history' | 'about'

type ClearAction = 'recents' | 'positions' | 'session'

type SettingsDialogProps = {
  open: boolean
  initialSection?: SettingsSection
  sectionRequestId?: number
  settings: ReaderSettingsV1
  recents: RecentFileV1[]
  logoSrc: string
  persistenceError?: string
  onClose: () => void
  onSettingsChange: (patch: Partial<ReaderSettingsV1>) => void
  onOpenRecent: (path: string) => void
  onRemoveRecent: (path: string) => void
  onClearRecents: () => void
  onClearPositions: () => void
  onClearSession: () => void
}

const sections: Array<{ id: SettingsSection; label: string; Icon: typeof BookOpen }> = [
  { id: 'appearance', label: '阅读与外观', Icon: BookOpen },
  { id: 'history', label: '启动与历史', Icon: Clock3 },
  { id: 'about', label: '关于 MdStudio', Icon: Info },
]

const themeChoices: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

const widthChoices: Array<{ value: ReadingWidth; label: string; width: number | null }> = [
  { value: 'compact', label: '紧凑', width: 720 },
  { value: 'standard', label: '标准', width: 820 },
  { value: 'wide', label: '宽屏', width: 980 },
  { value: 'fit', label: '适应屏幕', width: null },
]

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path
}

export function SettingsDialog({
  open,
  initialSection = 'appearance',
  sectionRequestId = 0,
  settings,
  recents,
  logoSrc,
  persistenceError,
  onClose,
  onSettingsChange,
  onOpenRecent,
  onRemoveRecent,
  onClearRecents,
  onClearPositions,
  onClearSession,
}: SettingsDialogProps) {
  const t = useI18n()
  const [section, setSection] = useState<SettingsSection>('appearance')
  const [version, setVersion] = useState('正在读取…')
  const [versionUnavailable, setVersionUnavailable] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ClearAction | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (open) setSection(initialSection)
  }, [open, initialSection, sectionRequestId])

  useEffect(() => {
    if (!open) return
    let active = true
    void getVersion().then(value => {
      if (active) {
        setVersion(value)
        setVersionUnavailable(false)
      }
    }).catch(() => {
      if (active) {
        setVersion('当前环境不可用')
        setVersionUnavailable(true)
      }
    })
    return () => { active = false }
  }, [open])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    requestAnimationFrame(() => dialogRef.current?.focus())
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  if (!open) return null

  const confirmDetails: Record<ClearAction, { title: string; description: string; action: () => void }> = {
    recents: {
      title: '清空最近文件？',
      description: '只会移除本地最近文件记录，不会关闭已打开标签，也不会删除磁盘文件。',
      action: onClearRecents,
    },
    positions: {
      title: '清除阅读位置？',
      description: '只清除跨重启保存的位置；当前页面不会跳动。',
      action: onClearPositions,
    },
    session: {
      title: '清除恢复会话？',
      description: '下次启动时不恢复当前这组标签；目前打开的文档会继续保留。',
      action: onClearSession,
    },
  }

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setConfirmAction(null)
      onCloseRef.current()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
    )
    if (!focusable?.length) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const activeConfirm = confirmAction ? confirmDetails[confirmAction] : null

  return (
    <div className="settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        <header className="settings-header">
          <div className="settings-title-group">
            <span className="settings-title-icon"><Settings2 size={17} /></span>
            <div><h2 id="settings-title">{t('设置')}</h2><p>{t('调整阅读体验与启动行为')}</p></div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('关闭设置')} title={t('关闭设置')}><X size={17} /></button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" role="tablist" aria-label={t('设置分类')} aria-orientation="vertical">
            {sections.map(({ id, label, Icon }, index) => (
              <button
                key={id}
                id={`settings-tab-${id}`}
                className={'settings-nav-item' + (section === id ? ' is-active' : '')}
                type="button"
                role="tab"
                aria-selected={section === id}
                aria-controls="settings-panel"
                tabIndex={section === id ? 0 : -1}
                onClick={() => { setSection(id); setConfirmAction(null) }}
                onKeyDown={event => {
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + sections.length) % sections.length
                  setSection(sections[next].id)
                  requestAnimationFrame(() => document.getElementById(`settings-tab-${sections[next].id}`)?.focus())
                }}
              ><Icon size={16} /><span>{t(label)}</span></button>
            ))}
          </nav>

          <div className="settings-content" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${section}`}>
            {persistenceError && <div className="settings-error" role="alert">{t(persistenceError)}</div>}
            {section === 'appearance' && <div className="settings-section">
              <div className="settings-section-heading"><h3>{t('阅读与外观')}</h3><p>{t('偏好会立即应用，并保存在本机。')}</p></div>
              <fieldset className="settings-field">
                <legend>{t('界面语言')}</legend>
                <select
                  className="settings-language-select"
                  aria-label={t('界面语言')}
                  value={settings.locale ?? 'zh-CN'}
                  onChange={event => onSettingsChange({ locale: event.target.value as ReaderSettingsV1['locale'] })}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                </select>
                <p className="settings-field-hint">{t('更改 MdStudio 界面语言，不会翻译文档内容。')}</p>
              </fieldset>
              <fieldset className="settings-field">
                <legend>{t('主题')}</legend>
                <div className="settings-segmented" role="group" aria-label={t('阅读主题')}>
                  {themeChoices.map(choice => <button
                    key={choice.value}
                    type="button"
                    className={settings.theme === choice.value ? 'is-selected' : ''}
                    aria-pressed={settings.theme === choice.value}
                    onClick={() => onSettingsChange({ theme: choice.value })}
                  >{t(choice.label)}</button>)}
                </div>
              </fieldset>

              <fieldset className="settings-field">
                <legend>{t('正文字号')} <output htmlFor="reader-font-size">{settings.fontSizePx} px</output></legend>
                <div className="settings-range-row">
                  <span aria-hidden="true">12</span>
                  <input
                    id="reader-font-size"
                    aria-label={t('正文字号')}
                    type="range"
                    min={12}
                    max={24}
                    step={1}
                    value={settings.fontSizePx}
                    onChange={event => onSettingsChange({ fontSizePx: Number(event.target.value) })}
                  />
                  <span aria-hidden="true">24</span>
                </div>
              </fieldset>

              <fieldset className="settings-field">
                <legend>{t('阅读宽度')} <output>{settings.readingWidth === 'fit' ? t('自动适配') : `${READING_WIDTH_PX[settings.readingWidth]} px`}</output></legend>
                <div className="settings-width-options" role="group" aria-label={t('阅读宽度')}>
                  {widthChoices.map(choice => <button
                    key={choice.value}
                    type="button"
                    className={settings.readingWidth === choice.value ? 'is-selected' : ''}
                    aria-pressed={settings.readingWidth === choice.value}
                    onClick={() => onSettingsChange({ readingWidth: choice.value })}
                  ><span>{t(choice.label)}</span><small>{choice.width === null ? t('自动适配') : `${choice.width}px`}</small></button>)}
                </div>
              </fieldset>

              <div className="settings-reset-row">
                <span>{t('仅重置本页阅读偏好')}</span>
                <button type="button" className="settings-secondary-button" onClick={() => onSettingsChange({
                  theme: DEFAULT_READER_SETTINGS.theme,
                  fontSizePx: DEFAULT_READER_SETTINGS.fontSizePx,
                  readingWidth: DEFAULT_READER_SETTINGS.readingWidth,
                })}>{t('恢复阅读默认值')}</button>
              </div>
            </div>}

            {section === 'history' && <div className="settings-section">
              <div className="settings-section-heading"><h3>{t('启动与历史')}</h3><p>{t('仅保存本地文件路径与阅读位置，不缓存文档正文。')}</p></div>
              <div className="settings-toggle-row">
                <div><strong>{t('恢复上次打开的标签')}</strong><span>{t('下次启动时恢复标签顺序与当前文档')}</span></div>
                <button type="button" className="settings-switch" role="switch" aria-checked={settings.restoreTabs} aria-label={t('恢复上次打开的标签')} onClick={() => onSettingsChange({ restoreTabs: !settings.restoreTabs })}><span /></button>
              </div>
              <div className="settings-toggle-row">
                <div><strong>{t('记住阅读位置')}</strong><span>{t('跨重启回到最近阅读章节；关闭后不再记录新位置')}</span></div>
                <button type="button" className="settings-switch" role="switch" aria-checked={settings.rememberPosition} aria-label={t('记住阅读位置')} onClick={() => onSettingsChange({ rememberPosition: !settings.rememberPosition })}><span /></button>
              </div>
              <div className="settings-toggle-row">
                <div><strong>{t('双击标签页关闭')}</strong><span>{t('双击文件标签可快速关闭；关闭后仍可使用标签上的 × 按钮。')}</span></div>
                <button type="button" className="settings-switch" role="switch" aria-checked={settings.doubleClickToClose} aria-label={t('双击标签页关闭')} onClick={() => onSettingsChange({ doubleClickToClose: !settings.doubleClickToClose })}><span /></button>
              </div>

              <div className="settings-history-actions">
                <button type="button" className="settings-secondary-button" onClick={() => setConfirmAction('positions')}>{t('清空阅读位置')}</button>
                <button type="button" className="settings-secondary-button" onClick={() => setConfirmAction('session')}>{t('清空恢复会话')}</button>
              </div>

              <section className="settings-recents" aria-labelledby="settings-recents-title">
                <div className="settings-recents-heading">
                  <div><h4 id="settings-recents-title">{t('最近文件')}</h4><span>{recents.length} / 20</span></div>
                  <button type="button" className="settings-text-button" disabled={recents.length === 0} onClick={() => setConfirmAction('recents')}>{t('清空列表')}</button>
                </div>
                {recents.length === 0 ? <p className="settings-empty">{t('还没有最近打开的 Markdown 文件。')}</p> : <ul className="settings-recent-list">
                  {recents.map(item => <li key={item.path} title={item.path}>
                    <button type="button" className="settings-recent-open" onClick={() => onOpenRecent(item.path)}>
                      <strong>{fileName(item.path)}</strong><span>{item.path}</span>
                    </button>
                    <button type="button" className="settings-recent-remove" aria-label={t('从最近文件移除 {name}', { name: fileName(item.path) })} title={t('从最近文件移除')} onClick={() => onRemoveRecent(item.path)}><Trash2 size={14} /></button>
                  </li>)}
                </ul>}
              </section>

              {activeConfirm && <div className="settings-confirm" role="alertdialog" aria-labelledby="settings-confirm-title" aria-describedby="settings-confirm-description">
                <div><strong id="settings-confirm-title">{t(activeConfirm.title)}</strong><p id="settings-confirm-description">{t(activeConfirm.description)}</p></div>
                <div className="settings-confirm-actions">
                  <button type="button" className="settings-secondary-button" onClick={() => setConfirmAction(null)}>{t('取消')}</button>
                  <button type="button" className="settings-danger-button" onClick={() => { activeConfirm.action(); setConfirmAction(null) }}>{t('确认清除')}</button>
                </div>
              </div>}
            </div>}

            {section === 'about' && <div className="settings-section settings-about">
              <img src={logoSrc} alt="MdStudio" className="settings-about-logo" />
              <div className="settings-about-name"><h3>MdStudio</h3><span>Just Read Markdown.</span></div>
              <p className="settings-about-description">{t('一款轻量、离线优先的 Markdown 阅读器。打开即读，专注文档内容。')}</p>
              <dl className="settings-about-details">
                <div><dt>{t('版本')}</dt><dd aria-live="polite">{t(version)}{versionUnavailable && <span className="settings-about-note">{t('（请在桌面应用中查看）')}</span>}</dd></div>
                <div><dt>{t('产品')}</dt><dd>{t('只读 Markdown 阅读器')}</dd></div>
              </dl>
            </div>}
          </div>
        </div>
      </section>
    </div>
  )
}
