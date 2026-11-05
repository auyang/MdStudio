export interface WorkspaceUiPreferences {
  sidebarCollapsed: boolean
  sidebarWidth: number
}

export const WORKSPACE_UI_STORAGE_KEY = 'mdstudio-workspace-ui-v2'
export const LEGACY_WORKSPACE_UI_STORAGE_KEY = 'mdstudio-workspace-ui-v1'
export const WORKSPACE_ROOT_STORAGE_KEY = 'mdstudio-workspace-root-v1'
export const DEFAULT_WORKSPACE_UI_PREFERENCES: WorkspaceUiPreferences = {
  sidebarCollapsed: false,
  sidebarWidth: 230,
}

export function loadWorkspaceUiPreferences(storage: Pick<Storage, 'getItem'>): WorkspaceUiPreferences {
  try {
    const raw = storage.getItem(WORKSPACE_UI_STORAGE_KEY)
    if (raw) return parseWorkspacePreferences(raw, DEFAULT_WORKSPACE_UI_PREFERENCES)
    // V1 的 collapsed 表示旧工作区抽屉默认关闭，不能沿用为新版导航栏的收起状态。
    const legacy = storage.getItem(LEGACY_WORKSPACE_UI_STORAGE_KEY)
    if (!legacy) return { ...DEFAULT_WORKSPACE_UI_PREFERENCES }
    const migrated = parseWorkspacePreferences(legacy, DEFAULT_WORKSPACE_UI_PREFERENCES)
    return { sidebarCollapsed: false, sidebarWidth: migrated.sidebarWidth }
  } catch {
    return { ...DEFAULT_WORKSPACE_UI_PREFERENCES }
  }
}

function parseWorkspacePreferences(raw: string, fallback: WorkspaceUiPreferences): WorkspaceUiPreferences {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...fallback }
    const value = parsed as Partial<WorkspaceUiPreferences>
    return {
      sidebarCollapsed: typeof value.sidebarCollapsed === 'boolean' ? value.sidebarCollapsed : fallback.sidebarCollapsed,
      sidebarWidth: typeof value.sidebarWidth === 'number' && Number.isFinite(value.sidebarWidth)
        ? Math.min(340, Math.max(190, Math.round(value.sidebarWidth)))
        : fallback.sidebarWidth,
    }
  } catch {
    return { ...fallback }
  }
}

export function saveWorkspaceUiPreferences(
  storage: Pick<Storage, 'setItem'>,
  preferences: WorkspaceUiPreferences,
): boolean {
  try {
    storage.setItem(WORKSPACE_UI_STORAGE_KEY, JSON.stringify({
      sidebarCollapsed: preferences.sidebarCollapsed,
      sidebarWidth: Math.min(340, Math.max(190, Math.round(preferences.sidebarWidth))),
    }))
    return true
  } catch {
    return false
  }
}

export function loadLastWorkspacePath(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    const path = storage.getItem(WORKSPACE_ROOT_STORAGE_KEY)
    return path && path.length > 0 ? path : null
  } catch {
    return null
  }
}

export function saveLastWorkspacePath(storage: Pick<Storage, 'setItem'>, path: string): boolean {
  try {
    storage.setItem(WORKSPACE_ROOT_STORAGE_KEY, path)
    return true
  } catch {
    return false
  }
}
