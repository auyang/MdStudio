import { ChevronDown } from 'lucide-react'
import { useRef } from 'react'
import type { DocumentType } from '../../features/documents/core/types'
import type { ReadingWidth } from '../../features/reader/preferences'
import { READING_WIDTH_PX } from '../../features/reader/preferences'
import { useI18n } from '../../features/i18n'

const widthChoices: Array<{ value: ReadingWidth; label: string }> = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'wide', label: '宽屏' },
]
const fitScreenChoice = { value: 'fit' as const, label: '适应屏幕' }

type ReadingWidthPickerProps = {
  value: ReadingWidth
  onChange: (value: ReadingWidth) => void
  documentType?: DocumentType | null
  onFitWidth?: () => void
  onFitHeight?: () => void
}

export function ReadingWidthPicker({ value, onChange, documentType, onFitWidth, onFitHeight }: ReadingWidthPickerProps) {
  const t = useI18n()
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const supportsPageFit = documentType === 'pdf' || documentType === 'ofd'
  const choices = supportsPageFit ? widthChoices : [...widthChoices, fitScreenChoice]
  const selected = choices.find(choice => choice.value === value) ?? widthChoices[2]
  const closeMenu = () => {
    if (detailsRef.current) detailsRef.current.open = false
  }

  return (
    <details ref={detailsRef} className="reader-width-picker" data-dismiss-outside>
      <summary title={t('阅读宽度')} aria-label={t('阅读宽度：{label}', { label: t(selected.label) })}>
        <span className="reader-width-prefix">{t('阅读宽度')}:</span>
        <span>{t(selected.label)}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </summary>
      <div className="reader-width-menu" role="group" aria-label={t('阅读宽度')}>
        {choices.map(choice => <button
          key={choice.value}
          type="button"
          aria-pressed={value === choice.value}
          className={value === choice.value ? 'is-selected' : ''}
          onClick={() => {
            onChange(choice.value)
            closeMenu()
          }}
        >{t(choice.label)}{choice.value === 'fit' ? ` · ${t('自动适配')}` : ` · ${READING_WIDTH_PX[choice.value]}px`}</button>)}
        {supportsPageFit && onFitWidth && onFitHeight && <>
          <button type="button" onClick={() => { onFitWidth(); closeMenu() }}>{t('适应宽度')}</button>
          <button type="button" onClick={() => { onFitHeight(); closeMenu() }}>{t('适应高度')}</button>
        </>}
      </div>
    </details>
  )
}
