import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_UI_PREFERENCES,
  LEGACY_WORKSPACE_UI_STORAGE_KEY,
  loadWorkspaceUiPreferences,
  saveWorkspaceUiPreferences,
  WORKSPACE_UI_STORAGE_KEY,
} from './preferences'

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('workspace sidebar preferences', () => {
  it('starts with the 230px navigation sidebar expanded when there is no stored preference', () => {
    expect(loadWorkspaceUiPreferences(memoryStorage())).toEqual(DEFAULT_WORKSPACE_UI_PREFERENCES)
    expect(DEFAULT_WORKSPACE_UI_PREFERENCES).toEqual({ sidebarCollapsed: false, sidebarWidth: 230 })
  })

  it('migrates the old hidden workspace drawer to the expanded navigation sidebar', () => {
    const storage = memoryStorage({ [LEGACY_WORKSPACE_UI_STORAGE_KEY]: JSON.stringify({ sidebarCollapsed: true, sidebarWidth: 250 }) })
    expect(loadWorkspaceUiPreferences(storage)).toEqual({ sidebarCollapsed: false, sidebarWidth: 250 })
  })

  it('persists the collapsed state and clamps the saved width', () => {
    const storage = memoryStorage()
    expect(saveWorkspaceUiPreferences(storage, { sidebarCollapsed: false, sidebarWidth: 999 })).toBe(true)
    expect(loadWorkspaceUiPreferences(storage)).toEqual({ sidebarCollapsed: false, sidebarWidth: 340 })
    expect(storage.getItem(WORKSPACE_UI_STORAGE_KEY)).toContain('340')
  })

  it('recovers from invalid or corrupted local values', () => {
    expect(loadWorkspaceUiPreferences(memoryStorage({ [WORKSPACE_UI_STORAGE_KEY]: 'bad json' })))
      .toEqual(DEFAULT_WORKSPACE_UI_PREFERENCES)
    const storage = memoryStorage({ [WORKSPACE_UI_STORAGE_KEY]: JSON.stringify({ sidebarWidth: 10 }) })
    expect(loadWorkspaceUiPreferences(storage)).toEqual({ sidebarCollapsed: false, sidebarWidth: 190 })
  })
})
