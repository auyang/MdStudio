export type EditorMode = 'visual' | 'source' | 'split'
export type LineEnding = 'lf' | 'crlf' | 'cr'

export type ConflictState =
  | 'no_conflict'
  | 'external_changed'
  | 'merge_available'
  | 'manual_resolution_required'
  | 'remote_deleted'
  | 'remote_renamed'

export interface ExternalChange {
  state: ConflictState
  operation: 'modified' | 'created' | 'removed' | 'renamed' | 'recovered'
  baseContent: string
  baseHash: string | null
  remoteContent: string | null
  remoteHash: string | null
  remotePath: string | null
  observedAt: number
}

export interface DocumentSession {
  documentId: string
  filePath: string | null
  originalContent: string
  currentContent: string
  diskVersionHash: string | null
  revision: number
  isDirty: boolean
  activeMode: EditorMode
  encoding: 'utf-8'
  bom: boolean
  lineEnding: LineEnding
  lastSavedAt: number | null
  diskConflict: boolean
  externalChange: ExternalChange | null
}

export interface DocumentSnapshot {
  filePath: string
  content: string
  diskVersionHash: string
  bom: boolean
  lineEnding: LineEnding
}

export function createUntitledSession(): DocumentSession {
  return {
    documentId: crypto.randomUUID(),
    filePath: null,
    originalContent: '',
    currentContent: '',
    diskVersionHash: null,
    revision: 0,
    isDirty: false,
    activeMode: 'visual',
    encoding: 'utf-8',
    bom: false,
    lineEnding: 'lf',
    lastSavedAt: null,
    diskConflict: false,
    externalChange: null,
  }
}

export function createSession(snapshot: DocumentSnapshot): DocumentSession {
  return {
    ...createUntitledSession(),
    filePath: snapshot.filePath,
    originalContent: snapshot.content,
    currentContent: snapshot.content,
    diskVersionHash: snapshot.diskVersionHash,
    bom: snapshot.bom,
    lineEnding: snapshot.lineEnding,
  }
}

export function updateSessionContent(session: DocumentSession, content: string): DocumentSession {
  if (content === session.currentContent) return session
  return {
    ...session,
    currentContent: content,
    revision: session.revision + 1,
    isDirty: content !== session.originalContent,
  }
}

export function markExternalChange(
  session: DocumentSession,
  remote: {
    operation: ExternalChange['operation']
    content: string | null
    hash: string | null
    path?: string | null
  },
): DocumentSession {
  if (remote.hash && remote.hash === session.diskVersionHash) return session
  const state: ConflictState = remote.operation === 'removed'
    ? 'remote_deleted'
    : remote.operation === 'renamed'
      ? 'remote_renamed'
      : remote.content !== null && session.currentContent !== session.originalContent
        ? 'merge_available'
        : 'external_changed'
  return {
    ...session,
    diskConflict: true,
    externalChange: {
      state,
      operation: remote.operation,
      baseContent: session.originalContent,
      baseHash: session.diskVersionHash,
      remoteContent: remote.content,
      remoteHash: remote.hash,
      remotePath: remote.path ?? null,
      observedAt: Date.now(),
    },
  }
}

export function acceptRemoteVersion(
  session: DocumentSession,
  remote: DocumentSnapshot,
): DocumentSession {
  return {
    ...session,
    filePath: remote.filePath,
    originalContent: remote.content,
    currentContent: remote.content,
    diskVersionHash: remote.diskVersionHash,
    bom: remote.bom,
    lineEnding: remote.lineEnding,
    revision: session.revision + 1,
    isDirty: false,
    diskConflict: false,
    externalChange: null,
  }
}

export function markSessionSaved(
  session: DocumentSession,
  filePath: string,
  diskVersionHash: string,
  savedContent = session.currentContent,
  savedRevision = session.revision,
): DocumentSession {
  const currentContent = session.revision === savedRevision ? savedContent : session.currentContent
  return {
    ...session,
    filePath,
    originalContent: savedContent,
    currentContent,
    diskVersionHash,
    isDirty: currentContent !== savedContent,
    diskConflict: false,
    externalChange: null,
    lastSavedAt: Date.now(),
  }
}

