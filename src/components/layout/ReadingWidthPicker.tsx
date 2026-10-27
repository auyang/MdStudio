import { ChevronDown } from 'lucide-react'
import { useRef } from 'react'
import type { ReadingWidth } from '../../features/reader/preferences'
import { READING_WIDTH_PX } from '../../features/reader/preferences'
import { useI18n } from '../../features/i18n'

const choices: Array<{ value: ReadingWidth; label: string }> = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'wide', label: '宽屏' },
  { value: 'fit', label: '适应屏幕' },
]

type ReadingWidthPickerProps = {
  value: ReadingWidth
  onChange: (value: ReadingWidth) => void
}

export function ReadingWidthPicker({ value, onChange }: ReadingWidthPickerProps) {
  const t = useI18n()
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const selected = choices.find(choice => choice.value === value) ?? choices[2]

  return (
    <details ref={detailsRef} className="reader-width-picker">
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
            if (detailsRef.current) detailsRef.current.open = false
          }}
        >{t(choice.label)}{choice.value === 'fit' ? ` · ${t('自动适配')}` : ` · ${READING_WIDTH_PX[choice.value]}px`}</button>)}
      </div>
    </details>
  )
}
