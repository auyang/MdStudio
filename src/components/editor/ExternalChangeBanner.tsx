import { AlertTriangle, Save } from 'lucide-react'
import type { ExternalChange } from '../../features/documents/session'
import { useI18n } from '../../features/i18n'

type ExternalChangeBannerProps = {
  change: ExternalChange
  dismissed?: boolean
  onReload: () => void
  onSaveAs: () => void
  onContinue: () => void
}

export function ExternalChangeBanner({ change, dismissed = false, onReload, onSaveAs, onContinue }: ExternalChangeBannerProps) {
  const t = useI18n()
  if (dismissed) return null
  const removed = change.operation === 'removed' || change.operation === 'renamed'
  return <aside className="editor-conflict-banner" role="alert">
    <AlertTriangle size={16} />
    <div className="editor-conflict-copy">
      <strong>{t(removed ? '源文件已删除或移动' : '文件已在外部修改')}</strong>
      <span>{t('当前编辑内容仍保留在内存中，未覆盖外部文件。')}</span>
    </div>
    {!removed && <button type="button" onClick={onReload}>{t('重新加载')}</button>}
    <button type="button" className="editor-conflict-save-as" onClick={onSaveAs}><Save size={14} />{t('另存为')}</button>
    <button type="button" className="editor-conflict-continue" onClick={onContinue}>{t('继续编辑')}</button>
  </aside>
}
