import { invoke, isTauri } from '@tauri-apps/api/core'

export const performanceEnabled = import.meta.env.VITE_PERF_BENCHMARK === '1'
export const performanceRunId = Math.random().toString(36).slice(2, 10)
export const performancePageStart = performance.now()

type SampleFields = Record<string, number | string | boolean | null | undefined>

/** 仅在显式启用的基准构建中记录耗时与数量，不记录路径、关键词或文档正文。 */
export function recordPerformance(event: string, fields: SampleFields = {}) {
  if (!performanceEnabled || !isTauri()) return
  const sample = {
    buildLabel: import.meta.env.VITE_PERF_LABEL ?? 'local',
    runId: performanceRunId,
    event,
    appElapsedMs: Number((performance.now() - performancePageStart).toFixed(3)),
    ...fields,
  }
  void invoke('record_performance_sample', { sample: JSON.stringify(sample) }).catch(() => undefined)
}
