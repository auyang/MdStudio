export interface ChangeHunk {
  start: number
  end: number
  replacement: string[]
}

export interface MergeConflict {
  start: number
  end: number
  base: string[]
  local: string[]
  remote: string[]
}

export interface ThreeWayMergeResult {
  status: 'merged' | 'conflicts' | 'manual_resolution_required'
  content: string | null
  conflicts: MergeConflict[]
  reason?: string
}

type Operation =
  | { kind: 'equal'; line: string }
  | { kind: 'insert'; line: string }
  | { kind: 'delete'; line: string }

const MAX_DIFF_LINES = 20_000
const MAX_EDIT_DISTANCE = 512

export function diffHunks(baseText: string, targetText: string): ChangeHunk[] | null {
  const base = baseText.split('\n')
  const target = targetText.split('\n')
  if (base.length + target.length > MAX_DIFF_LINES * 2) return null

  const operations = myersDiff(base, target)
  if (!operations) return null
  const hunks: ChangeHunk[] = []
  let baseIndex = 0
  let active: ChangeHunk | null = null

  const flush = () => {
    if (active) hunks.push(active)
    active = null
  }

  for (const operation of operations) {
    if (operation.kind === 'equal') {
      flush()
      baseIndex += 1
    } else if (operation.kind === 'delete') {
      active ??= { start: baseIndex, end: baseIndex, replacement: [] }
      active.end += 1
      baseIndex += 1
    } else {
      active ??= { start: baseIndex, end: baseIndex, replacement: [] }
      active.replacement.push(operation.line)
    }
  }
  flush()
  return hunks
}

export function mergeThreeWay(baseText: string, localText: string, remoteText: string): ThreeWayMergeResult {
  const base = baseText.split('\n')
  const local = diffHunks(baseText, localText)
  const remote = diffHunks(baseText, remoteText)
  if (!local || !remote) {
    return {
      status: 'manual_resolution_required',
      content: null,
      conflicts: [],
      reason: '文档差异过大，已停止自动合并以避免阻塞界面。',
    }
  }

  const duplicateRemote = new Set<number>()
  const conflicts: MergeConflict[] = []
  for (const localHunk of local) {
    for (let index = 0; index < remote.length; index += 1) {
      const remoteHunk = remote[index]
      if (sameHunk(localHunk, remoteHunk)) {
        duplicateRemote.add(index)
      } else if (overlaps(localHunk, remoteHunk)) {
        conflicts.push({
          start: Math.min(localHunk.start, remoteHunk.start),
          end: Math.max(localHunk.end, remoteHunk.end),
          base: base.slice(Math.min(localHunk.start, remoteHunk.start), Math.max(localHunk.end, remoteHunk.end)),
          local: localHunk.replacement,
          remote: remoteHunk.replacement,
        })
      }
    }
  }
  if (conflicts.length > 0) {
    return { status: 'conflicts', content: null, conflicts: deduplicateConflicts(conflicts) }
  }

  const changes = [
    ...local.map((hunk) => ({ hunk, order: 0 })),
    ...remote.filter((_, index) => !duplicateRemote.has(index)).map((hunk) => ({ hunk, order: 1 })),
  ].sort((left, right) => left.hunk.start - right.hunk.start
    || left.hunk.end - right.hunk.end
    || left.order - right.order)

  const output: string[] = []
  let cursor = 0
  for (const { hunk } of changes) {
    if (hunk.start < cursor) {
      return {
        status: 'manual_resolution_required',
        content: null,
        conflicts: [],
        reason: '检测到边界重叠，已停止自动合并。',
      }
    }
    output.push(...base.slice(cursor, hunk.start), ...hunk.replacement)
    cursor = hunk.end
  }
  output.push(...base.slice(cursor))
  return { status: 'merged', content: output.join('\n'), conflicts: [] }
}

function myersDiff(base: string[], target: string[]): Operation[] | null {
  const n = base.length
  const m = target.length
  const maxDistance = Math.min(n + m, MAX_EDIT_DISTANCE)
  const frontier = new Map<number, number>([[1, 0]])
  const trace: Map<number, number>[] = []

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    trace.push(new Map(frontier))
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const fromDelete = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY
      const fromInsert = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY
      let x = diagonal === -distance || (diagonal !== distance && fromDelete < fromInsert)
        ? fromInsert
        : fromDelete + 1
      if (!Number.isFinite(x)) x = 0
      let y = x - diagonal
      while (x < n && y < m && base[x] === target[y]) {
        x += 1
        y += 1
      }
      frontier.set(diagonal, x)
      if (x >= n && y >= m) return backtrack(trace, base, target, distance)
    }
  }
  return null
}

function backtrack(
  trace: Map<number, number>[],
  base: string[],
  target: string[],
  maxDistance: number,
): Operation[] {
  let x = base.length
  let y = target.length
  const operations: Operation[] = []

  for (let distance = maxDistance; distance >= 0; distance -= 1) {
    const frontier = trace[distance]
    const diagonal = x - y
    const fromDelete = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY
    const fromInsert = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY
    const previousDiagonal = diagonal === -distance || (diagonal !== distance && fromDelete < fromInsert)
      ? diagonal + 1
      : diagonal - 1
    const previousX = frontier.get(previousDiagonal) ?? 0
    const previousY = previousX - previousDiagonal

    while (x > previousX && y > previousY) {
      operations.push({ kind: 'equal', line: base[x - 1] })
      x -= 1
      y -= 1
    }
    if (distance === 0) break
    if (x === previousX) {
      operations.push({ kind: 'insert', line: target[y - 1] })
      y -= 1
    } else {
      operations.push({ kind: 'delete', line: base[x - 1] })
      x -= 1
    }
  }
  return operations.reverse()
}

function overlaps(left: ChangeHunk, right: ChangeHunk): boolean {
  if (left.start === left.end && right.start === right.end) return left.start === right.start
  if (left.start === left.end) return left.start >= right.start && left.start <= right.end
  if (right.start === right.end) return right.start >= left.start && right.start <= left.end
  return Math.max(left.start, right.start) < Math.min(left.end, right.end)
}

function sameHunk(left: ChangeHunk, right: ChangeHunk): boolean {
  return left.start === right.start && left.end === right.end
    && left.replacement.length === right.replacement.length
    && left.replacement.every((line, index) => line === right.replacement[index])
}

function deduplicateConflicts(conflicts: MergeConflict[]): MergeConflict[] {
  const output: MergeConflict[] = []
  for (const conflict of conflicts.sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = output.at(-1)
    if (previous && conflict.start <= previous.end) {
      previous.end = Math.max(previous.end, conflict.end)
      previous.local = [...previous.local, ...conflict.local]
      previous.remote = [...previous.remote, ...conflict.remote]
    } else {
      output.push({ ...conflict })
    }
  }
  return output
}

