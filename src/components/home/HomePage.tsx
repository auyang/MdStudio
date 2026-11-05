import { FolderOpen, FileText, FileType2, ScrollText } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AppLocale, RecentFileV1 } from '../../features/reader/preferences'
import { useI18n } from '../../features/i18n'
import { RecentFilesTable } from './RecentFilesTable'

interface HomePageProps {
  logo: ReactNode
  recents: (RecentFileV1 & { byteSize?: number })[]
  locale: AppLocale
  onOpen: () => void
  onOpenWorkspace: () => void
  onOpenRecent: (path: string) => void
  onRemoveRecent: (path: string) => void
  onShowAllRecents: () => void
}

export function HomePage({ logo, recents, locale, onOpen, onOpenWorkspace, onOpenRecent, onRemoveRecent, onShowAllRecents }: HomePageProps) {
  const t = useI18n()
  return <div className="home-page welcome-panel">
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-hero-copy">
        <div className="home-brand-mark welcome-logo">{logo}</div>
        <span className="home-eyebrow">{t('本地文档阅读工作台')}</span>
        <h1 id="home-title">{t('打开即读，简单纯粹。')}</h1>
        <p>{t('支持 Markdown、PDF 与 OFD。')}</p>
        <div className="home-actions">
          <button className="open-button primary" type="button" onClick={onOpen}><FolderOpen size={16} />{t('打开文档')}</button>
          <button className="open-button" type="button" onClick={onOpenWorkspace}><FolderOpen size={15} />{t('打开工作区')}</button>
        </div>
        <span className="home-file-types">{t('支持 .md、.markdown、.pdf 和 .ofd')}</span>
      </div>
      <div className="home-format-visual" aria-label={t('支持 Markdown、PDF 与 OFD')}>
        <div className="format-sheet format-sheet-markdown"><FileText size={19} /><span>MD</span><i /><i /><i /></div>
        <div className="format-sheet format-sheet-pdf"><FileType2 size={20} /><span>PDF</span><i /><i /><i /></div>
        <div className="format-sheet format-sheet-ofd"><ScrollText size={20} /><span>OFD</span><i /><i /><i /></div>
        <span className="format-caption">{t('三种格式，一个阅读空间')}</span>
      </div>
    </section>
    <RecentFilesTable files={recents} locale={locale} onOpen={onOpenRecent} onRemove={onRemoveRecent} limit={5} onShowAll={onShowAllRecents} />
  </div>
}

export function RecentFilesPage({ files, locale, onOpen, onRemove }: {
  files: (RecentFileV1 & { byteSize?: number })[]
  locale: AppLocale
  onOpen: (path: string) => void
  onRemove: (path: string) => void
}) {
  const t = useI18n()
  return <div className="navigation-page recent-page">
    <header className="navigation-page-heading"><span className="section-kicker">{t('本机记录')}</span><h1>{t('最近打开')}</h1><p>{t('最近访问过的本地文档。')}</p></header>
    <RecentFilesTable files={files} locale={locale} onOpen={onOpen} onRemove={onRemove} />
  </div>
}

export function WorkspaceLanding({ workspaceName, hasWorkspace, onOpenWorkspace }: { workspaceName?: string; hasWorkspace: boolean; onOpenWorkspace: () => void }) {
  const t = useI18n()
  return <div className="navigation-page workspace-entry">
    <div className="workspace-entry-mark"><FolderOpen size={23} /></div>
    <span className="section-kicker">{t('工作区')}</span>
    <h1>{hasWorkspace ? workspaceName : t('打开一个工作区')}</h1>
    <p>{hasWorkspace ? t('从左侧目录选择文档。') : t('打开文件夹后，在这里浏览 Markdown、PDF 与 OFD 文档。')}</p>
    {!hasWorkspace && <button className="open-button primary" type="button" onClick={onOpenWorkspace}><FolderOpen size={16} />{t('打开工作区')}</button>}
  </div>
}
