import { Clock3, FolderOpen, House, PanelLeftClose, PanelLeftOpen, Settings2 } from 'lucide-react'
import type { PointerEvent, ReactNode } from 'react'
import { useRef } from 'react'
import { useI18n } from '../../features/i18n'

export type SidebarSection = 'home' | 'recent' | 'workspace' | 'settings'

interface SidebarNavigationProps {
  active: SidebarSection
  expanded: boolean
  width: number
  workspaceAvailable: boolean
  workspaceContent?: ReactNode
  onNavigate: (section: Exclude<SidebarSection, 'settings'>) => void
  onOpenSettings: () => void
  onChooseWorkspace: () => void
  onToggleExpanded: () => void
  onWidthChange: (width: number) => void
}

const items = [
  { id: 'home', label: '首页', Icon: House },
  { id: 'recent', label: '最近', Icon: Clock3 },
  { id: 'workspace', label: '工作区', Icon: FolderOpen },
] as const

export function SidebarNavigation({ active, expanded, width, workspaceAvailable, workspaceContent, onNavigate, onOpenSettings, onChooseWorkspace, onToggleExpanded, onWidthChange }: SidebarNavigationProps) {
  const t = useI18n()
  const resizeOrigin = useRef<{ x: number; width: number } | null>(null)
  const onResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    resizeOrigin.current = { x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeOrigin.current) onWidthChange(resizeOrigin.current.width + event.clientX - resizeOrigin.current.x)
  }
  const onResizeEnd = (event: PointerEvent<HTMLDivElement>) => {
    resizeOrigin.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <aside className={'app-sidebar' + (expanded ? '' : ' is-collapsed')} style={{ width: expanded ? width : 56 }} aria-label={t('主导航')}>
    <div className="app-sidebar-top">
      <span className="app-sidebar-caption">{expanded ? t('工作台') : ''}</span>
      <button type="button" className="icon-button compact app-sidebar-toggle" onClick={onToggleExpanded} aria-label={t(expanded ? '收起侧边栏' : '展开侧边栏')} title={t(expanded ? '收起侧边栏' : '展开侧边栏')}>
        {expanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>
    </div>
    <nav className="app-sidebar-nav" aria-label={t('主导航')}>
      {items.map(({ id, label, Icon }) => <button
        key={id}
        type="button"
        className={'app-sidebar-nav-item' + (active === id ? ' is-active' : '')}
        aria-current={active === id ? 'page' : undefined}
        title={t(label)}
        onClick={() => id === 'workspace' && !workspaceAvailable ? onChooseWorkspace() : onNavigate(id)}
      ><Icon size={17} /><span>{t(label)}</span></button>)}
    </nav>
    {workspaceAvailable && workspaceContent && <div className="app-sidebar-workspace" hidden={active !== 'workspace'}>{workspaceContent}</div>}
    <div className="app-sidebar-bottom">
      <button type="button" className={'app-sidebar-nav-item' + (active === 'settings' ? ' is-active' : '')} aria-current={active === 'settings' ? 'page' : undefined} title={t('设置')} onClick={onOpenSettings}>
        <Settings2 size={17} /><span>{t('设置')}</span>
      </button>
    </div>
    {expanded && <div className="app-sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label={t('调整侧边栏宽度')} aria-valuemin={190} aria-valuemax={340} aria-valuenow={width} tabIndex={0}
      onPointerDown={onResizeStart} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        onWidthChange(width + (event.key === 'ArrowRight' ? 12 : -12))
      }} />}
  </aside>
}
