import { FileText, LoaderCircle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ReaderTabStatus } from '../../features/reader/tabs'
import { useI18n } from '../../features/i18n'
import type { AppLocale, RecentFileV1 } from '../../features/reader/preferences'
import { HomePage } from '../home/HomePage'

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

export function ReaderWelcomePanel({ logo, onOpen, onOpenWorkspace, recents = [], locale = 'zh-CN', onOpenRecent, onRemoveRecent, onShowAllRecents }: {
  logo: ReactNode
  onOpen: () => void
  onOpenWorkspace: () => void
  recents?: (RecentFileV1 & { byteSize?: number })[]
  locale?: AppLocale
  onOpenRecent: (path: string) => void
  onRemoveRecent: (path: string) => void
  onShowAllRecents: () => void
}) {
  return <HomePage logo={logo} recents={recents} locale={locale} onOpen={onOpen} onOpenWorkspace={onOpenWorkspace}
    onOpenRecent={onOpenRecent} onRemoveRecent={onRemoveRecent} onShowAllRecents={onShowAllRecents} />
}
