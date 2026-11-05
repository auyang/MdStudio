import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useI18n } from '../../features/i18n'

export type UnsavedActionKind = 'close-tab' | 'switch-workspace' | 'quit-window' | 'quit-app'

type UnsavedChangesDialogProps = {
  open: boolean
  kind: UnsavedActionKind
  fileNames: string[]
  error?: string
  onSave: () => void | Promise<void>
  onDiscard: () => void | Promise<void>
  onCancel: () => void
}

export function UnsavedChangesDialog({
  open,
  kind,
  fileNames,
  error,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  const t = useI18n()
  const [busy, setBusy] = useState(false)
  if (!open) return null
  const title = kind === 'close-tab' ? t('保存更改后关闭？')
    : kind === 'switch-workspace' ? t('切换工作区前保存更改？')
      : t('退出前保存更改？')
  const description = kind === 'close-tab'
    ? t('此 Markdown 文档有未保存更改。')
    : t('有 {count} 个 Markdown 文档包含未保存更改。', { count: fileNames.length })
  const saveLabel = kind === 'close-tab' ? t('保存') : t('全部保存')
  const discardLabel = kind === 'close-tab' ? t('放弃更改') : t('全部放弃')
  const run = async (action: () => void | Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }

  return <div className="editor-dialog-backdrop" role="presentation">
    <section className="editor-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-description">
      <div className="editor-confirm-icon"><AlertTriangle size={19} /></div>
      <h2 id="unsaved-title">{title}</h2>
      <p id="unsaved-description">{description}</p>
      {fileNames.length > 0 && <ul className="editor-confirm-files">{fileNames.slice(0, 4).map(name => <li key={name}>{name}</li>)}</ul>}
      {error && <p className="editor-confirm-error" role="alert">{t(error)}</p>}
      <div className="editor-confirm-actions">
        <button type="button" className="editor-confirm-cancel" onClick={onCancel} disabled={busy}>{t('取消')}</button>
        <button type="button" className="editor-confirm-discard" onClick={() => { void run(onDiscard) }} disabled={busy}>{discardLabel}</button>
        <button type="button" className="editor-confirm-save" onClick={() => { void run(onSave) }} disabled={busy}>{busy ? t('正在保存…') : saveLabel}</button>
      </div>
    </section>
  </div>
}
