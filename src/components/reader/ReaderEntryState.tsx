import { FileText, FolderOpen, LoaderCircle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ReaderTabStatus } from '../../features/reader/tabs'
import { useI18n } from '../../features/i18n'
import type { RecentFileV1 } from '../../features/reader/preferences'

type ReaderLoadState = {
  displayName: string
  status: ReaderTabStatus
  error?: string
}

export function ReaderTabLoadState({ tab, onRetry }: { tab: ReaderLoadState; onRetry: () => void }) {
  const t = useI18n()

  return (
    <section className="reader-tab-load-state" role={tab.status === 'error' ? 'alert' : 'status'}>
      {tab.status === 'loading' ? <LoaderCircle className="is-spinning" size={22} /> : <FileText size={22} />}
      <strong>{tab.displayName}</strong>
      <span>{t(tab.error || (tab.status === 'loading' ? '正在读取文档…' : '文档尚未读取。'))}</span>
      {tab.status !== 'loading' && <button className="open-button" onClick={onRetry}><RefreshCw size={15} />{t('重试打开')}</button>}
    </section>
  )
}

function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function ReaderWelcomePanel({ logo, onOpen, recents = [], onOpenRecent }: { logo: ReactNode; onOpen: () => void; recents?: RecentFileV1[]; onOpenRecent?: (path: string) => void }) {
  const t = useI18n()

  return (
    <section className="welcome-panel">
      <div className="welcome-logo">{logo}</div>
      <div className="welcome-copy"><h1>{t('打开即读，简单纯粹。')}</h1><p>{t('选择一份文档，或将文件拖到这里。')}</p></div>
      <button className="open-button primary" onClick={onOpen}><FolderOpen size={16} /><span>{t('打开文档')}</span></button>
      <span className="file-types">{t('支持 .md、.markdown、.pdf 和 .ofd')}</span>
      {recents.length > 0 && onOpenRecent && <section className="welcome-recents" aria-label={t('最近文件')}>
        <strong>{t('最近文件')}</strong>
        <ul>{recents.slice(0, 5).map(item => <li key={item.path}>
          <button type="button" onClick={() => onOpenRecent(item.path)} title={item.path}>
            <FileText size={14} aria-hidden="true" /><span>{fileName(item.path)}</span>
          </button>
        </li>)}</ul>
      </section>}
    </section>
  )
}
