import { FileText, MoreHorizontal, ScrollText, Trash2 } from 'lucide-react'
import type { AppLocale } from '../../features/reader/preferences'
import type { RecentFileV1 } from '../../features/reader/preferences'
import { useI18n } from '../../features/i18n'

type RecentFileRow = RecentFileV1 & { byteSize?: number }

interface RecentFilesTableProps {
  files: RecentFileRow[]
  locale: AppLocale
  onOpen: (path: string) => void
  onRemove: (path: string) => void
  limit?: number
  onShowAll?: () => void
}

function baseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function fileType(file: RecentFileV1): 'markdown' | 'pdf' | 'ofd' {
  if (file.documentType) return file.documentType
  const suffix = file.path.split('.').at(-1)?.toLowerCase()
  return suffix === 'pdf' ? 'pdf' : suffix === 'ofd' ? 'ofd' : 'markdown'
}

function formatSize(bytes: number | undefined) {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(timestamp: number, locale: AppLocale) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
  const localeName = locale === 'zh-CN' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US'
  return new Intl.DateTimeFormat(localeName, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

export function RecentFilesTable({ files, locale, onOpen, onRemove, limit, onShowAll }: RecentFilesTableProps) {
  const t = useI18n()
  const visibleFiles = limit ? files.slice(0, limit) : files

  return (
    <section className="recent-files-section" aria-label={t('最近文件')}>
      <div className="recent-files-heading">
        <div>
          <span className="section-kicker">{t('本机记录')}</span>
          <h2>{t('最近打开')}</h2>
        </div>
        {onShowAll && files.length > (limit ?? 0) && <button className="recent-show-all" type="button" onClick={onShowAll}>{t('查看全部')}<span aria-hidden="true">↗</span></button>}
      </div>

      {visibleFiles.length === 0 ? <div className="recent-empty" role="status">
        <span>{t('还没有最近打开的文件。')}</span>
      </div> : <div className="recent-table" role="table" aria-label={t('最近打开')}>
        <div className="recent-table-head" role="row">
          <span role="columnheader">{t('文档')}</span>
          <span role="columnheader" className="recent-size-column">{t('大小')}</span>
          <span role="columnheader" className="recent-date-column">{t('最近打开时间')}</span>
          <span role="columnheader" className="recent-actions-column"><span className="sr-only">{t('操作')}</span></span>
        </div>
        {visibleFiles.map(file => {
          const type = fileType(file)
          const name = baseName(file.path)
          const dateTime = Number.isFinite(file.openedAt) && file.openedAt > 0 ? new Date(file.openedAt).toISOString() : undefined
          return <div className="recent-table-row" role="row" key={file.path}>
            <div className="recent-document-cell" role="cell">
              <span className={`recent-file-icon is-${type}`} aria-hidden="true">
                {type === 'ofd' ? <ScrollText size={17} /> : <FileText size={17} />}
                <span>{type === 'markdown' ? 'MD' : type.toUpperCase()}</span>
              </span>
              <button className="recent-document-open" type="button" onClick={() => onOpen(file.path)} title={file.path}>
                <strong>{name}</strong><span>{file.path}</span>
              </button>
            </div>
            <span className="recent-size-column recent-cell-muted" role="cell">{formatSize(file.byteSize)}</span>
            <time className="recent-date-column recent-cell-muted" role="cell" dateTime={dateTime}>{formatDate(file.openedAt, locale)}</time>
            <div className="recent-actions-column recent-row-actions" role="cell">
              <details className="recent-more" data-dismiss-outside>
                <summary aria-label={t('更多操作')} title={t('更多操作')}><MoreHorizontal size={17} /></summary>
                <div className="recent-more-menu">
                  <button type="button" onClick={() => onRemove(file.path)}><Trash2 size={14} />{t('从最近文件移除')}</button>
                </div>
              </details>
            </div>
          </div>
        })}
      </div>}
    </section>
  )
}
