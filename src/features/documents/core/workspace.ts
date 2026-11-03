import type { ReaderTabsState } from '../../reader/tabs'

// 沿用阅读器已有的去重、激活顺序和关闭语义作为文档工作区状态。
export type DocumentWorkspace<TPayload> = ReaderTabsState<TPayload>
