export type WorkspaceDocumentType = 'markdown' | 'pdf' | 'ofd'

export interface WorkspaceRoot {
  path: string
  displayName: string
}

export interface WorkspaceEntry {
  name: string
  path: string
  isDirectory: boolean
  documentType: WorkspaceDocumentType | null
}

export interface WorkspaceDirectoryListing {
  directoryPath: string
  entries: WorkspaceEntry[]
  truncated: boolean
}
