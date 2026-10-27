export type ReadingLocation = {
  filePath: string
  headingId?: string
  scrollTop: number
  scrollRatio: number
  headingOffset?: number
  restoreMode: 'position' | 'heading'
}

export type NavigationHistory = {
  entries: ReadingLocation[]
  currentIndex: number
}

export const MAX_NAVIGATION_ENTRIES = 100

export const emptyNavigationHistory: NavigationHistory = {
  entries: [],
  currentIndex: -1,
}

function sameDestination(first: ReadingLocation, second: ReadingLocation): boolean {
  return first.filePath === second.filePath && first.headingId === second.headingId
}

function limitHistory(entries: ReadingLocation[], currentIndex: number): NavigationHistory {
  const overflow = Math.max(0, entries.length - MAX_NAVIGATION_ENTRIES)
  return {
    entries: entries.slice(overflow),
    currentIndex: Math.max(-1, currentIndex - overflow),
  }
}

export function recordNavigation(
  history: NavigationHistory,
  departure: ReadingLocation,
  target: ReadingLocation,
): NavigationHistory {
  if (sameDestination(departure, target)) return history

  if (history.currentIndex < 0 || !history.entries.length) {
    return { entries: [departure, target], currentIndex: 1 }
  }

  const entries = history.entries.slice(0, history.currentIndex + 1)
  let currentIndex = entries.length - 1
  const current = entries[currentIndex]
  if (current?.filePath === departure.filePath) {
    entries[currentIndex] = departure
  } else {
    entries.push(departure)
    currentIndex += 1
  }

  if (!sameDestination(entries[currentIndex], target)) {
    entries.push(target)
    currentIndex += 1
  }
  return limitHistory(entries, currentIndex)
}

export function moveNavigation(
  history: NavigationHistory,
  direction: -1 | 1,
  departure?: ReadingLocation,
): { history: NavigationHistory; target: ReadingLocation | null } {
  if (!history.entries.length || history.currentIndex < 0) return { history, target: null }
  const current = history.entries[history.currentIndex]
  if (!current) return { history, target: null }

  const nextIndex = history.currentIndex + direction
  if (nextIndex < 0 || nextIndex >= history.entries.length) return { history, target: null }

  const entries = [...history.entries]
  if (departure && departure.filePath === current.filePath) entries[history.currentIndex] = departure
  return {
    history: { entries, currentIndex: nextIndex },
    target: entries[nextIndex],
  }
}
